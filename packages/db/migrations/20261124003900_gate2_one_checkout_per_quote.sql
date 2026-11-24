-- A quote can have one checkout creation identity. Provider retries reconcile
-- that identity by the stable quote key instead of opening a second checkout.
create unique index gate2_one_checkout_created_per_quote
    on public.gate2_payment_events (quote_id) where event_kind = 'checkout_created';
