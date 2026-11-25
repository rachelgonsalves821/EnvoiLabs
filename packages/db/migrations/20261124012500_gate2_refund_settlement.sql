-- Provider creation is claimed before a Stripe request. A missing response is
-- uncertainty, never proof that a refund was not created.
create table internal.gate2_refund_intents (
    reservation_id uuid primary key references public.gate2_refund_reservations (id),
    idempotency_key text not null unique,
    first_attempt_at timestamptz not null,
    lease_expires_at timestamptz not null,
    attempts integer not null check (attempts between 1 and 3)
);
alter table internal.gate2_refund_intents enable row level security;
revoke all on internal.gate2_refund_intents
    from public, anon, authenticated, service_role;

create table internal.gate2_refund_events (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null references public.gate2_refund_reservations (id),
    provider_refund_id text not null check (provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),
    provider_event_id text not null unique,
    event_kind text not null check (event_kind in ('pending', 'succeeded', 'failed')),
    amount_cents integer not null check (amount_cents > 0),
    provider_observed_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),
    unique (reservation_id, event_kind)
);
alter table internal.gate2_refund_events enable row level security;
revoke all on internal.gate2_refund_events
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_refund_event
    before update or delete on internal.gate2_refund_events
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.claim_gate2_refund_intent(
    requested_reservation_id uuid, supplied_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.gate2_refund_reservations%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    intent internal.gate2_refund_intents%rowtype;
    known_id text;
    checkout_id text;
    observed_at timestamptz;
begin
    select * into target from public.gate2_refund_reservations
        where id = requested_reservation_id;
    if not found then raise check_violation; end if;
    perform 1 from public.studies as study
    where study.id = target.study_id and study.state in ('closed', 'cancelled')
        and exists (select 1 from public.researchers as researcher
            where researcher.organization_id = study.organization_id
                and researcher.auth_user_id = supplied_auth_user_id)
    for update;
    if not found then raise check_violation; end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = target.quote_id and study_id = target.study_id for share;
    if not found or frozen.total_cents < target.amount_cents
    then raise check_violation; end if;
    select paid.provider_checkout_id into checkout_id
    from public.gate2_payment_events as paid
    where paid.quote_id = frozen.id and paid.event_kind = 'paid'
        and paid.amount_cents = frozen.total_cents and paid.currency = frozen.currency
        and exists (select 1 from public.gate2_payment_events as created
            where created.quote_id = frozen.id and created.event_kind = 'checkout_created'
                and created.provider_checkout_id = paid.provider_checkout_id);
    if checkout_id is null then raise check_violation; end if;
    select provider_refund_id into known_id from internal.gate2_refund_events
        where reservation_id = target.id order by created_at limit 1;
    if known_id is not null then return jsonb_build_object('status', 'known',
        'refundId', known_id, 'checkoutId', checkout_id,
        'amountCents', target.amount_cents, 'studyId', target.study_id,
        'quoteId', target.quote_id, 'quoteTotalCents', frozen.total_cents,
        'pricingConfigVersion', frozen.pricing_config_version); end if;
    if exists (select 1 from public.gate2_payment_events as event
        where event.quote_id = target.quote_id
            and event.event_kind in ('failed', 'refunded'))
    then raise check_violation; end if;
    observed_at := clock_timestamp();
    select * into intent from internal.gate2_refund_intents
        where reservation_id = target.id for update;
    if not found then
        insert into internal.gate2_refund_intents (reservation_id,
            idempotency_key, first_attempt_at, lease_expires_at, attempts)
        values (target.id, target.idempotency_key, observed_at,
            observed_at + interval '30 seconds', 1);
    elsif intent.first_attempt_at <= observed_at - interval '23 hours'
        or intent.attempts >= 3 or intent.lease_expires_at > observed_at
    then return jsonb_build_object('status', 'unavailable');
    else
        update internal.gate2_refund_intents
        set lease_expires_at = observed_at + interval '30 seconds',
            attempts = attempts + 1 where reservation_id = target.id;
    end if;
    return jsonb_build_object('status', 'create',
        'key', target.idempotency_key, 'checkoutId', checkout_id,
        'amountCents', target.amount_cents, 'quoteId', target.quote_id,
        'studyId', target.study_id,
        'quoteTotalCents', frozen.total_cents,
        'pricingConfigVersion', frozen.pricing_config_version);
end;
$$;
revoke all on function public.claim_gate2_refund_intent(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_refund_intent(uuid, uuid) to service_role;

create function public.record_gate2_refund_observation(
    requested_reservation_id uuid, requested_refund_id text,
    requested_kind text, requested_amount_cents integer,
    requested_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.gate2_refund_reservations%rowtype;
    prior internal.gate2_refund_events%rowtype;
    event_id text;
begin
    select * into target from public.gate2_refund_reservations
        where id = requested_reservation_id;
    if not found then return false; end if;
    perform pg_catalog.pg_advisory_xact_lock(1127944272, 2);
    perform 1 from public.studies where id = target.study_id for update;
    event_id := 'stripe-refund-state:' || requested_refund_id || ':' || requested_kind;
    if requested_refund_id is null
        or requested_refund_id !~ '^re_[A-Za-z0-9_]+$'
        or requested_kind not in ('pending', 'succeeded', 'failed')
        or requested_amount_cents is distinct from target.amount_cents
        or requested_observed_at is null
        or not exists (select 1 from internal.gate2_refund_intents
            where reservation_id = target.id)
    then return false; end if;
    select * into prior from internal.gate2_refund_events
        where provider_event_id = event_id;
    if found then return prior.reservation_id = target.id
        and prior.provider_refund_id = requested_refund_id
        and prior.amount_cents = requested_amount_cents; end if;
    if exists (select 1 from internal.gate2_refund_events as existing
        where (existing.provider_refund_id = requested_refund_id
                and existing.reservation_id <> target.id)
            or (existing.reservation_id = target.id
                and (existing.provider_refund_id <> requested_refund_id
                or existing.event_kind in ('succeeded', 'failed')
                or existing.provider_observed_at > requested_observed_at)))
    then return false; end if;
    insert into internal.gate2_refund_events (reservation_id,
        provider_refund_id, provider_event_id, event_kind, amount_cents,
        provider_observed_at)
    values (target.id, requested_refund_id, event_id, requested_kind,
        requested_amount_cents, requested_observed_at);
    return true;
end;
$$;
revoke all on function public.record_gate2_refund_observation(
    uuid, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate2_refund_observation(
    uuid, text, text, integer, timestamptz) to service_role;
