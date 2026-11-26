-- The frozen refund uses the same reviewed-complete population as the private snapshot.
create or replace function public.reserve_gate2_unfilled_slot_refund(
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
    select (public.read_gate2_approved_complete_snapshot(
        target.id, frozen.id, supplied_auth_user_id)
        ->> 'approvedCompleteCount')::integer into fulfilled;
    if fulfilled is null then raise check_violation; end if;
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
