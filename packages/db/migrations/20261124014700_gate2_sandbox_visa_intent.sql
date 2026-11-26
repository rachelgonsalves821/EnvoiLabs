-- Synthetic testflight routing only. Real recipient verification and a payout
-- threshold/aggregation policy must precede any production payout route.
create table internal.gate2_sandbox_visa_routes (
    respondent_id uuid primary key references public.respondents (id) on delete cascade,
    recipient_name text not null check (length(btrim(recipient_name)) between 2 and 120),
    recipient_email text not null check (recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    country text not null check (country ~ '^[A-Z]{2}$'),
    verification_receipt text not null check (verification_receipt ~ '^synthetic:[A-Za-z0-9_-]{8,}$')
);
create table internal.gate2_sandbox_visa_products (
    country text primary key check (country ~ '^[A-Z]{2}$'),
    product_id text not null check (product_id ~ '^[A-Za-z0-9_-]{3,100}$'),
    minimum_cents integer not null check (minimum_cents > 0),
    maximum_cents integer not null check (maximum_cents >= minimum_cents),
    catalog_receipt text not null check (catalog_receipt ~ '^synthetic:[A-Za-z0-9_-]{8,}$')
);
create table internal.gate2_sandbox_visa_intents (
    payout_id uuid primary key references public.payouts (id),
    session_id uuid not null unique references public.sessions (id),
    respondent_id uuid not null references public.respondents (id),
    amount_cents integer not null check (amount_cents > 0),
    recipient_name text not null,
    recipient_email text not null,
    country text not null,
    product_id text not null,
    verification_receipt text not null,
    catalog_receipt text not null
);
revoke all on internal.gate2_sandbox_visa_routes,
    internal.gate2_sandbox_visa_products, internal.gate2_sandbox_visa_intents
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_sandbox_visa_routes before update or delete
    on internal.gate2_sandbox_visa_routes for each row
    execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_sandbox_visa_products before update or delete
    on internal.gate2_sandbox_visa_products for each row
    execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_sandbox_visa_intents before update or delete
    on internal.gate2_sandbox_visa_intents for each row
    execute function internal.reject_gate2_ledger_mutation();

create function public.reserve_gate2_sandbox_visa_intent(
    requested_session_id uuid, annual_cap_cents integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid;
    route internal.gate2_sandbox_visa_routes%rowtype;
    product internal.gate2_sandbox_visa_products%rowtype;
    reserved_payout_id uuid;
    payout public.payouts%rowtype;
    intent internal.gate2_sandbox_visa_intents%rowtype;
    earned integer;
begin
    select offer.respondent_id into owner_id from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    where interview.id = requested_session_id;
    if owner_id is null then raise check_violation; end if;
    perform 1 from public.respondents where id = owner_id and status = 'active' for update;
    if not found then raise check_violation; end if;
    select * into payout from public.payouts
    where idempotency_key = 'payout:' || requested_session_id::text for update;
    if found then
        if payout.session_id is distinct from requested_session_id
            or payout.respondent_id is distinct from owner_id
        then raise check_violation; end if;
        select * into intent from internal.gate2_sandbox_visa_intents
        where gate2_sandbox_visa_intents.payout_id = payout.id;
        if found then
            return jsonb_build_object('id', payout.id,
                'sessionId', requested_session_id,
                'respondentId', owner_id, 'recipientId', payout.id,
                'productId', intent.product_id,
                'amountCents', payout.amount_cents, 'state', payout.state,
                'providerOrderId', payout.tremendous_order_id);
        end if;
    end if;
    select * into route from internal.gate2_sandbox_visa_routes
    where respondent_id = owner_id;
    if not found then raise check_violation using message = 'sandbox recipient absent'; end if;
    select * into product from internal.gate2_sandbox_visa_products
    where country = route.country;
    if not found then raise check_violation using message = 'sandbox Visa SKU absent'; end if;
    earned := internal.gate2_marketplace_earned_cents(requested_session_id);
    if earned is null or earned < product.minimum_cents
        or earned > product.maximum_cents
    then raise check_violation using message = 'reward outside sandbox Visa denomination'; end if;
    reserved_payout_id := public.reserve_gate2_session_payout(requested_session_id,
        owner_id, earned, annual_cap_cents,
        'payout:' || requested_session_id::text);
    select * into payout from public.payouts
    where id = reserved_payout_id for update;
    select * into intent from internal.gate2_sandbox_visa_intents
    where gate2_sandbox_visa_intents.payout_id = payout.id;
    if not found then
        if payout.state <> 'pending' or payout.tremendous_order_id is not null
        then raise check_violation using message = 'payout was ordered before route freeze'; end if;
        insert into internal.gate2_sandbox_visa_intents (payout_id, session_id,
            respondent_id, amount_cents, recipient_name, recipient_email,
            country, product_id, verification_receipt, catalog_receipt)
        values (payout.id, requested_session_id, owner_id, earned,
            route.recipient_name, route.recipient_email, route.country,
            product.product_id, route.verification_receipt, product.catalog_receipt)
        returning * into intent;
    end if;
    if (intent.session_id, intent.respondent_id, intent.amount_cents,
        intent.recipient_name, intent.recipient_email, intent.country,
        intent.product_id, intent.verification_receipt, intent.catalog_receipt)
        is distinct from (requested_session_id, owner_id, earned,
        route.recipient_name, route.recipient_email, route.country,
        product.product_id, route.verification_receipt, product.catalog_receipt)
    then raise check_violation using message = 'sandbox route changed after freeze'; end if;
    return jsonb_build_object('id', payout.id, 'sessionId', requested_session_id,
        'respondentId', owner_id, 'recipientId', payout.id,
        'productId', intent.product_id, 'amountCents', payout.amount_cents,
        'state', payout.state, 'providerOrderId', payout.tremendous_order_id);
end;
$$;
revoke all on function public.reserve_gate2_sandbox_visa_intent(uuid, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_sandbox_visa_intent(uuid, integer)
    to service_role;

create function public.read_gate2_sandbox_visa_recipient(requested_payout_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('name', recipient_name, 'email', recipient_email,
        'country', country) from internal.gate2_sandbox_visa_intents
    where payout_id = requested_payout_id;
$$;
revoke all on function public.read_gate2_sandbox_visa_recipient(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_sandbox_visa_recipient(uuid)
    to service_role;

create function public.record_gate2_sandbox_visa_observation(
    requested_payout_id uuid, requested_recipient_id uuid,
    requested_product_id text, requested_event_id text,
    requested_order_id text, requested_kind text,
    requested_amount_cents integer, requested_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare intent internal.gate2_sandbox_visa_intents%rowtype;
begin
    select * into intent from internal.gate2_sandbox_visa_intents
    where payout_id = requested_payout_id;
    if not found or requested_recipient_id is distinct from intent.payout_id
        or requested_product_id is distinct from intent.product_id
        or requested_amount_cents is distinct from intent.amount_cents
    then return false; end if;
    return public.record_gate2_payout_observation(requested_payout_id,
        requested_event_id, requested_order_id, requested_kind,
        requested_amount_cents, requested_observed_at);
end;
$$;
revoke all on function public.record_gate2_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate2_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz)
    to service_role;
