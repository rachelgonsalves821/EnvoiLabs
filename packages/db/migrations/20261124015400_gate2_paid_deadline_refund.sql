-- A provider-confirmed paid quote that missed fieldwork cannot remain in
-- awaiting_payment forever. Reserve the frozen unfilled-slot refund atomically
-- with the system cancellation; provider refund issuance stays a separate step.
create function public.expire_gate2_paid_after_deadline(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_provider_event_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    paid public.gate2_payment_events%rowtype;
    prior public.gate2_refund_reservations%rowtype;
    made public.gate2_refund_reservations%rowtype;
    line jsonb;
    purchased integer;
    slot_cents integer;
begin
    select * into target from public.studies
        where id = supplied_study_id for update;
    if not found then return null; end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = supplied_quote_id and study_id = target.id for share;
    if not found or frozen.pricing_config_version < 101
        or frozen.currency <> 'usd' then return null; end if;
    select * into paid from public.gate2_payment_events
        where quote_id = frozen.id and study_id = target.id
            and provider_event_id = supplied_provider_event_id
            and event_kind = 'paid' and amount_cents = frozen.total_cents
            and currency = frozen.currency;
    if not found or not exists (select 1 from public.gate2_payment_events as created
        where created.quote_id = frozen.id and created.study_id = target.id
            and created.provider_checkout_id = paid.provider_checkout_id
            and created.event_kind = 'checkout_created'
            and created.amount_cents = frozen.total_cents
            and created.currency = frozen.currency)
    then return null; end if;
    select * into prior from public.gate2_refund_reservations
        where study_id = target.id and quote_id = frozen.id;
    if found then
        if target.state <> 'cancelled' or not exists (
            select 1 from public.audit_log as audit
            where audit.entity = 'study' and audit.entity_id = target.id
                and audit.from_state = 'awaiting_payment'
                and audit.to_state = 'cancelled'
                and audit.meta ->> 'reason' = 'paid_deadline_expired'
                and audit.meta ->> 'providerEventId' = paid.provider_event_id
                and audit.meta ->> 'quoteId' = frozen.id::text)
        then return null; end if;
        return jsonb_build_object('status', 'refund_reserved',
            'reservationId', prior.id, 'studyId', target.id,
            'quoteId', frozen.id,
            'amountCents', prior.amount_cents,
            'unfilledSlots', prior.unfilled_slots);
    end if;
    if target.state <> 'awaiting_payment'
        or exists (select 1 from public.gate2_payment_events as later
            where later.quote_id = frozen.id
                and later.event_kind in ('failed', 'refunded'))
        or target.deadline_at is null
        or target.deadline_at > clock_timestamp()
        or jsonb_array_length(frozen.line_items_json) <> 1
        or exists (select 1 from public.invites as offer
            where offer.study_id = target.id)
        or exists (select 1 from public.sessions as session
            where session.study_id = target.id)
    then return null; end if;
    line := frozen.line_items_json -> 0;
    if line ->> 'label' is distinct from 'Core questions'
        or (line ->> 'coreQuestionCount') !~ '^[0-9]+$'
        or (line ->> 'respondentCount') !~ '^[0-9]+$'
        or (line ->> 'unitPriceCents') !~ '^[0-9]+$'
    then return null; end if;
    purchased := (line ->> 'respondentCount')::integer;
    slot_cents := (line ->> 'coreQuestionCount')::integer *
        (line ->> 'unitPriceCents')::integer;
    if purchased < 10 or purchased <> target.target_completes
        or slot_cents <= 0 or (line ->> 'unitPriceCents')::integer <> 200
        or frozen.total_cents <> purchased * slot_cents
        or frozen.incentive_cents_per_complete <>
            (line ->> 'coreQuestionCount')::integer * 100
    then return null; end if;
    update public.studies set state = 'cancelled', updated_at = clock_timestamp()
        where id = target.id;
    insert into public.gate2_refund_reservations (quote_id, study_id,
        purchased_slots, fulfilled_slots, unfilled_slots,
        slot_price_cents, amount_cents, idempotency_key)
    values (frozen.id, target.id, purchased, 0, purchased, slot_cents,
        frozen.total_cents, 'gate2-unfilled-refund:' || frozen.id)
    returning * into made;
    insert into public.audit_log (entity, entity_id, from_state,
        to_state, actor, meta)
    values ('study', target.id, 'awaiting_payment', 'cancelled', 'platform',
        jsonb_build_object('reason', 'paid_deadline_expired',
            'quoteId', frozen.id, 'providerEventId', paid.provider_event_id,
            'pricingConfigVersion', frozen.pricing_config_version,
            'refundReservationId', made.id));
    return jsonb_build_object('status', 'refund_reserved',
        'reservationId', made.id, 'studyId', target.id,
        'quoteId', frozen.id,
        'amountCents', made.amount_cents,
        'unfilledSlots', made.unfilled_slots);
end;
$$;
revoke all on function public.expire_gate2_paid_after_deadline(
    uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.expire_gate2_paid_after_deadline(
    uuid, uuid, text) to service_role;
