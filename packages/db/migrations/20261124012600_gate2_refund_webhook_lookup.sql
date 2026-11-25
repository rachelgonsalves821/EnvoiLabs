-- A signed refund event carries a reservation ID, but it is only a hint. This
-- restricted read supplies the immutable local identity for exact provider
-- re-fetch, including when the create response was lost before recording ID.
create function public.read_gate2_refund_webhook_claim(
    requested_reservation_id uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'reservationId', reservation.id,
        'studyId', reservation.study_id,
        'quoteId', reservation.quote_id,
        'checkoutId', paid.provider_checkout_id,
        'amountCents', reservation.amount_cents,
        'quoteTotalCents', frozen.total_cents,
        'pricingConfigVersion', frozen.pricing_config_version,
        'key', intent.idempotency_key)
    from public.gate2_refund_reservations as reservation
    join internal.gate2_refund_intents as intent
        on intent.reservation_id = reservation.id
    join public.gate2_quote_snapshots as frozen
        on frozen.id = reservation.quote_id and frozen.study_id = reservation.study_id
    join public.gate2_payment_events as paid
        on paid.quote_id = frozen.id and paid.study_id = frozen.study_id
            and paid.event_kind = 'paid' and paid.amount_cents = frozen.total_cents
            and paid.currency = frozen.currency
    join public.gate2_payment_events as created
        on created.quote_id = frozen.id and created.study_id = frozen.study_id
            and created.event_kind = 'checkout_created'
            and created.provider_checkout_id = paid.provider_checkout_id
    where reservation.id = requested_reservation_id
        and frozen.pricing_config_version >= 101
        and intent.idempotency_key = 'gate2-unfilled-refund:' || frozen.id::text
    limit 1;
$$;
revoke all on function public.read_gate2_refund_webhook_claim(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_refund_webhook_claim(uuid)
    to service_role;
