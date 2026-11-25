-- Read a fresh researcher receipt from the frozen quote and append-only provider
-- observations. A return redirect or reserved refund is never a settlement.
create function public.read_gate2_current_researcher_receipt(supplied_study_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    frozen public.gate2_quote_snapshots%rowtype;
    reserved public.gate2_refund_reservations%rowtype;
    payment_status text;
    refund_status text;
begin
    if auth.uid() is null or auth.jwt() ->> 'aal' <> 'aal2'
        or not internal.researches_study(supplied_study_id)
    then return null; end if;
    select * into frozen from public.gate2_quote_snapshots as quote
    where quote.study_id = supplied_study_id
    order by (exists (select 1 from public.gate2_payment_events as paid
        where paid.quote_id = quote.id and paid.event_kind = 'paid')) desc,
        quote.created_at desc, quote.id desc limit 1;
    if not found then return null; end if;
    payment_status := case
        when exists (select 1 from public.gate2_payment_events
            where quote_id = frozen.id and event_kind = 'refunded') then 'refunded'
        when exists (select 1 from public.gate2_payment_events
            where quote_id = frozen.id and event_kind = 'paid') then 'paid'
        when exists (select 1 from public.gate2_payment_events
            where quote_id = frozen.id and event_kind = 'failed') then 'failed'
        when exists (select 1 from public.gate2_payment_events
            where quote_id = frozen.id and event_kind = 'checkout_created') then 'checkout_created'
        else 'quoted' end;
    select * into reserved from public.gate2_refund_reservations
        where quote_id = frozen.id;
    if found then
        refund_status := case
            when exists (select 1 from internal.gate2_refund_events
                where reservation_id = reserved.id and event_kind = 'succeeded') then 'succeeded'
            when exists (select 1 from internal.gate2_refund_events
                where reservation_id = reserved.id and event_kind = 'failed') then 'failed'
            when exists (select 1 from internal.gate2_refund_events
                where reservation_id = reserved.id and event_kind = 'pending') then 'pending'
            else 'reserved' end;
    end if;
    return jsonb_build_object('studyId', supplied_study_id,
        'quoteId', frozen.id, 'pricingConfigVersion', frozen.pricing_config_version,
        'currency', frozen.currency, 'lineItems', frozen.line_items_json,
        'totalCents', frozen.total_cents, 'paymentStatus', payment_status,
        'refund', case when reserved.id is null then null else
            jsonb_build_object('status', refund_status,
                'purchasedSlots', reserved.purchased_slots,
                'fulfilledSlots', reserved.fulfilled_slots,
                'unfilledSlots', reserved.unfilled_slots,
                'slotPriceCents', reserved.slot_price_cents,
                'amountCents', reserved.amount_cents) end);
end;
$$;
revoke all on function public.read_gate2_current_researcher_receipt(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_current_researcher_receipt(uuid)
    to authenticated;
