-- A signed provider notification is a hint only. The test-mode worker reads
-- this frozen claim before fetching and validating the current provider order.
create function public.read_gate2_sandbox_visa_webhook_claim(
    requested_payout_id uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'id', payout.id, 'recipientId', payout.id,
        'productId', intent.product_id,
        'amountCents', intent.amount_cents,
        'state', payout.state,
        'providerOrderId', payout.tremendous_order_id)
    from public.payouts as payout
    join internal.gate2_sandbox_visa_intents as intent
        on intent.payout_id = payout.id
    join public.respondents as respondent
        on respondent.id = intent.respondent_id
    where payout.id = requested_payout_id
        and payout.respondent_id = intent.respondent_id
        and payout.amount_cents = intent.amount_cents
        and respondent.status = 'active';
$$;
revoke all on function public.read_gate2_sandbox_visa_webhook_claim(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_sandbox_visa_webhook_claim(uuid)
    to service_role;
