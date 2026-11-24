-- A durable intent is written before asking Stripe to create a Session. A
-- missing provider response cannot be treated as proof of absence.
create table internal.gate2_checkout_intents (
    quote_id uuid primary key references public.gate2_quote_snapshots (id),
    study_id uuid not null,
    idempotency_key text not null unique,
    first_attempt_at timestamptz not null,
    lease_expires_at timestamptz not null,
    attempts integer not null check (attempts between 1 and 3),
    foreign key (quote_id, study_id) references public.gate2_quote_snapshots (id, study_id),
    check (idempotency_key = 'gate2-checkout:' || quote_id::text)
);
alter table internal.gate2_checkout_intents enable row level security;
revoke all on internal.gate2_checkout_intents from public, anon, authenticated, service_role;

create function public.claim_gate2_checkout_intent(
    supplied_study_id uuid, supplied_quote_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    frozen public.gate2_quote_snapshots%rowtype;
    intent internal.gate2_checkout_intents%rowtype;
    checkout_id text;
    observed_at timestamptz;
begin
    select * into frozen from public.gate2_quote_snapshots
    where id = supplied_quote_id and study_id = supplied_study_id for update;
    if not found then return jsonb_build_object('status', 'blocked'); end if;
    select provider_checkout_id into checkout_id from public.gate2_payment_events
    where quote_id = frozen.id and study_id = frozen.study_id
        and event_kind = 'checkout_created';
    if checkout_id is not null then return jsonb_build_object(
        'status', 'known', 'checkoutId', checkout_id); end if;
    observed_at := pg_catalog.clock_timestamp();
    select * into intent from internal.gate2_checkout_intents
    where quote_id = frozen.id for update;
    if not found then
        insert into internal.gate2_checkout_intents
            (quote_id, study_id, idempotency_key, first_attempt_at,
                lease_expires_at, attempts)
        values (frozen.id, frozen.study_id, 'gate2-checkout:' || frozen.id::text,
            observed_at, observed_at + interval '30 seconds', 1);
        return jsonb_build_object('status', 'create',
            'key', 'gate2-checkout:' || frozen.id::text);
    end if;
    -- The provider may prune v1 keys after 24 hours. A 23-hour safety bound
    -- allows limited same-key retries but never a late fresh creation.
    if intent.first_attempt_at <= observed_at - interval '23 hours'
        or intent.attempts >= 3 or intent.lease_expires_at > observed_at
    then return jsonb_build_object('status', 'unavailable'); end if;
    update internal.gate2_checkout_intents
    set lease_expires_at = observed_at + interval '30 seconds',
        attempts = attempts + 1 where quote_id = frozen.id;
    return jsonb_build_object('status', 'create', 'key', intent.idempotency_key);
end;
$$;
revoke all on function public.claim_gate2_checkout_intent(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_checkout_intent(uuid, uuid) to service_role;
