-- A refund reservation is an immutable decision at the frozen per-slot price.
-- No Stripe request is made here; later provider events remain a separate ledger.
create table public.gate2_refund_reservations (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null unique,
    study_id uuid not null unique,
    purchased_slots integer not null check (purchased_slots >= 10),
    fulfilled_slots integer not null check (fulfilled_slots >= 0),
    unfilled_slots integer not null check (unfilled_slots > 0),
    slot_price_cents integer not null check (slot_price_cents > 0),
    amount_cents integer not null check (amount_cents > 0),
    idempotency_key text not null unique,
    created_at timestamptz not null default clock_timestamp(),
    foreign key (quote_id, study_id)
        references public.gate2_quote_snapshots (id, study_id),
    check (fulfilled_slots + unfilled_slots = purchased_slots),
    check (amount_cents = unfilled_slots * slot_price_cents)
);
alter table public.gate2_refund_reservations enable row level security;
revoke all on public.gate2_refund_reservations
    from public, anon, authenticated, service_role;
grant select on public.gate2_refund_reservations to service_role;
create trigger immutable_gate2_refund_reservation
    before update or delete on public.gate2_refund_reservations
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.reserve_gate2_unfilled_slot_refund(
    supplied_study_id uuid, supplied_quote_id uuid, supplied_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    prior public.gate2_refund_reservations%rowtype;
    line jsonb;
    purchased integer;
    slot_cents integer;
    fulfilled integer;
    remaining integer;
    made public.gate2_refund_reservations%rowtype;
begin
    select * into target from public.studies
        where id = supplied_study_id for update;
    if not found or target.state not in ('closed', 'cancelled')
        or not exists (select 1 from public.researchers as researcher
            where researcher.organization_id = target.organization_id
                and researcher.auth_user_id = supplied_auth_user_id)
    then raise check_violation; end if;
    select * into prior from public.gate2_refund_reservations
        where quote_id = supplied_quote_id and study_id = target.id;
    if found then
        return jsonb_build_object('reservationId', prior.id,
            'amountCents', prior.amount_cents, 'unfilledSlots', prior.unfilled_slots,
            'idempotencyKey', prior.idempotency_key);
    end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = supplied_quote_id and study_id = target.id for share;
    if not found or frozen.pricing_config_version < 101
        or jsonb_array_length(frozen.line_items_json) <> 1
        or exists (select 1 from public.gate2_payment_events as event
            where event.quote_id = frozen.id and event.event_kind in ('failed', 'refunded'))
        or not exists (select 1 from public.gate2_payment_events as paid
            where paid.quote_id = frozen.id and paid.event_kind = 'paid'
                and paid.amount_cents = frozen.total_cents
                and paid.currency = frozen.currency
                and exists (select 1 from public.gate2_payment_events as created
                    where created.quote_id = frozen.id
                        and created.provider_checkout_id = paid.provider_checkout_id
                        and created.event_kind = 'checkout_created'
                        and created.amount_cents = frozen.total_cents))
        or exists (select 1 from public.sessions as interview
            where interview.study_id = target.id
                and interview.state in ('submitted', 'quality_hold'))
    then raise check_violation; end if;
    line := frozen.line_items_json -> 0;
    if line ->> 'label' is distinct from 'Core questions'
        or (line ->> 'coreQuestionCount') !~ '^[0-9]+$'
        or (line ->> 'respondentCount') !~ '^[0-9]+$'
        or (line ->> 'unitPriceCents') !~ '^[0-9]+$'
    then raise check_violation; end if;
    purchased := (line ->> 'respondentCount')::integer;
    slot_cents := (line ->> 'coreQuestionCount')::integer *
        (line ->> 'unitPriceCents')::integer;
    if purchased < 10 or slot_cents <= 0
        or (line ->> 'unitPriceCents')::integer <> 200
        or frozen.total_cents <> purchased * slot_cents
        or frozen.incentive_cents_per_complete <>
            (line ->> 'coreQuestionCount')::integer * 100
    then raise check_violation; end if;
    select count(distinct offer.respondent_id) into fulfilled
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    where interview.study_id = target.id
        and interview.state in ('approved', 'paid')
        and not exists (select 1 from public.removals as removal
            where removal.session_id = interview.id);
    if fulfilled > purchased then raise check_violation; end if;
    remaining := purchased - fulfilled;
    if remaining = 0 then return null; end if;
    insert into public.gate2_refund_reservations (quote_id, study_id,
        purchased_slots, fulfilled_slots, unfilled_slots,
        slot_price_cents, amount_cents, idempotency_key)
    values (frozen.id, target.id, purchased, fulfilled, remaining,
        slot_cents, remaining * slot_cents, 'gate2-unfilled-refund:' || frozen.id)
    returning * into made;
    return jsonb_build_object('reservationId', made.id,
        'amountCents', made.amount_cents, 'unfilledSlots', made.unfilled_slots,
        'idempotencyKey', made.idempotency_key);
end;
$$;
revoke all on function public.reserve_gate2_unfilled_slot_refund(uuid, uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_unfilled_slot_refund(uuid, uuid, uuid)
    to service_role;

-- Serialize late quality approval with reservation. An already approved session
-- may still move to paid; it does not change the fulfilled-slot count.
create function internal.gate2_guard_approved_after_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        if new.state not in ('approved', 'paid') then return new; end if;
    elsif old.state in ('approved', 'paid') and new.state in ('approved', 'paid')
        then return new;
    elsif old.state not in ('approved', 'paid') and new.state not in ('approved', 'paid')
        then return new;
    end if;
    perform 1 from public.studies where id = new.study_id for update;
    if exists (select 1 from public.gate2_refund_reservations
        where study_id = new.study_id)
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_approved_after_refund()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_approved_after_refund_insert
    before insert on public.sessions for each row
    execute function internal.gate2_guard_approved_after_refund();
create trigger gate2_guard_approved_after_refund_update
    before update of state on public.sessions for each row
    execute function internal.gate2_guard_approved_after_refund();

create function internal.gate2_guard_fulfilled_delete_after_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.state not in ('approved', 'paid') then return old; end if;
    perform 1 from public.studies where id = old.study_id for update;
    if exists (select 1 from public.gate2_refund_reservations
        where study_id = old.study_id)
    then raise check_violation; end if;
    return old;
end;
$$;
revoke all on function internal.gate2_guard_fulfilled_delete_after_refund()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_fulfilled_delete_after_refund
    before delete on public.sessions for each row
    execute function internal.gate2_guard_fulfilled_delete_after_refund();

-- Participation identities cannot be reassigned around a frozen slot count.
create function internal.gate2_reject_participation_reassignment()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_table_name = 'sessions' then
        if new.study_id is distinct from old.study_id
            or new.invite_id is distinct from old.invite_id
        then raise check_violation; end if;
    elsif new.study_id is distinct from old.study_id
        or new.respondent_id is distinct from old.respondent_id
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_reject_participation_reassignment()
    from public, anon, authenticated, service_role;
create trigger gate2_keep_session_identity
    before update of study_id, invite_id on public.sessions for each row
    execute function internal.gate2_reject_participation_reassignment();
create trigger gate2_keep_offer_identity
    before update of study_id, respondent_id on public.invites for each row
    execute function internal.gate2_reject_participation_reassignment();

create function internal.gate2_guard_removal_after_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_study_id uuid;
begin
    if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id
    then raise check_violation; end if;
    select interview.study_id into target_study_id from public.sessions as interview
    where interview.id = case when tg_op = 'DELETE' then old.session_id else new.session_id end;
    perform 1 from public.studies where id = target_study_id for update;
    if exists (select 1 from public.gate2_refund_reservations
        where study_id = target_study_id)
    then raise check_violation; end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function internal.gate2_guard_removal_after_refund()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_removal_after_refund
    before insert or update or delete on public.removals for each row
    execute function internal.gate2_guard_removal_after_refund();
