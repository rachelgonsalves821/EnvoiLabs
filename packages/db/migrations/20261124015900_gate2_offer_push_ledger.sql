-- Matched study offers use a separate push ledger from in-progress reminders.
-- The payload will open the authenticated respondent home, without study data.
create table internal.gate2_offer_push_outbox (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null references public.invites (id),
    consent_receipt bytea not null check (octet_length(consent_receipt) = 32),
    queued_at timestamptz not null default clock_timestamp(),
    unique (invite_id, consent_receipt)
);
create table internal.gate2_offer_push_deliveries (
    id uuid primary key default gen_random_uuid(),
    outbox_id uuid not null references internal.gate2_offer_push_outbox (id),
    subscription_id uuid references public.push_subscriptions (id) on delete set null,
    endpoint_hash bytea not null check (octet_length(endpoint_hash) = 32),
    state text not null default 'queued' check (state in ('queued', 'claimed', 'sent', 'failed')),
    claim_id uuid unique,
    claimed_at timestamptz,
    observed_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    unique (outbox_id, endpoint_hash),
    check ((state = 'queued' and claim_id is null and claimed_at is null and observed_at is null)
        or (state = 'claimed' and claim_id is not null and claimed_at is not null and observed_at is null)
        or (state in ('sent', 'failed') and claim_id is not null
            and claimed_at is not null and observed_at is not null))
);
alter table internal.gate2_offer_push_outbox enable row level security;
alter table internal.gate2_offer_push_deliveries enable row level security;
revoke all on internal.gate2_offer_push_outbox,
    internal.gate2_offer_push_deliveries
    from public, anon, authenticated, service_role;

create function internal.gate2_offer_push_consent_receipt(
    target_respondent uuid, target_study uuid)
returns bytea language sql stable security definer set search_path = '' as $$
    with general as (
        select id from public.consents
        where respondent_id = target_respondent and study_id is null
            and purpose = 'push_notifications'
        order by created_at desc, recorded_sequence desc limit 1
    ), specific as (
        select id from public.consents
        where respondent_id = target_respondent and study_id = target_study
            and purpose = 'push_notifications'
        order by created_at desc, recorded_sequence desc limit 1
    )
    select case when internal.gate1_consent(target_respondent, target_study,
        'push_notifications') then sha256(convert_to(
            coalesce((select id::text from general), 'none') || ':' ||
            coalesce((select id::text from specific), 'none'), 'UTF8'))
        else null end;
$$;
revoke all on function internal.gate2_offer_push_consent_receipt(uuid, uuid)
    from public, anon, authenticated, service_role;

create function internal.gate2_offer_push_current(target public.invites)
returns boolean language sql stable security definer set search_path = '' as $$
    select target.state = 'invited' and target.expires_at > clock_timestamp()
        and exists (select 1 from public.studies as study
            where study.id = target.study_id and study.state = 'fielding')
        and exists (select 1 from public.respondents as respondent
            where respondent.id = target.respondent_id and respondent.status = 'active'
                and internal.gate2_offer_push_consent_receipt(
                    respondent.id, target.study_id) is not null
                and exists (select 1 from public.push_subscriptions as subscription
                    where subscription.respondent_id = respondent.id))
        and exists (select 1 from public.gate2_quote_snapshots as quote
            join public.gate2_payment_events as paid
                on paid.quote_id = quote.id and paid.event_kind = 'paid'
            where quote.study_id = target.study_id
                and quote.pricing_config_version >= 101);
$$;
revoke all on function internal.gate2_offer_push_current(public.invites)
    from public, anon, authenticated, service_role;

create function public.list_gate2_offer_push_candidates()
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(candidate.id order by candidate.expires_at,
        candidate.id), '[]'::jsonb)
    from (select offer.id, offer.expires_at from public.invites as offer
        where internal.gate2_offer_push_current(offer)
            and not exists (select 1 from internal.gate2_offer_push_outbox
                where invite_id = offer.id and consent_receipt =
                    internal.gate2_offer_push_consent_receipt(
                        offer.respondent_id, offer.study_id))
        order by offer.expires_at, offer.id limit 500) as candidate;
$$;
revoke all on function public.list_gate2_offer_push_candidates()
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_offer_push_candidates() to service_role;

create function public.queue_gate2_offer_push(supplied_invite_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    offer public.invites%rowtype;
    receipt bytea;
begin
    select * into offer from public.invites where id = supplied_invite_id for update;
    if not found or not internal.gate2_offer_push_current(offer) then return false; end if;
    receipt := internal.gate2_offer_push_consent_receipt(
        offer.respondent_id, offer.study_id);
    if receipt is null then return false; end if;
    insert into internal.gate2_offer_push_outbox (invite_id, consent_receipt)
    values (offer.id, receipt)
    on conflict (invite_id, consent_receipt) do nothing;
    return true;
end;
$$;
revoke all on function public.queue_gate2_offer_push(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.queue_gate2_offer_push(uuid) to service_role;

create function public.list_gate2_offer_push_dispatchable()
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(item.id order by item.queued_at, item.id), '[]'::jsonb)
    from internal.gate2_offer_push_outbox as item
    join public.invites as offer on offer.id = item.invite_id
    where internal.gate2_offer_push_current(offer)
        and item.consent_receipt = internal.gate2_offer_push_consent_receipt(
            offer.respondent_id, offer.study_id)
        and (not exists (select 1 from internal.gate2_offer_push_deliveries
        where outbox_id = item.id)
        or exists (select 1 from internal.gate2_offer_push_deliveries as delivery
            join public.push_subscriptions as subscription
                on subscription.id = delivery.subscription_id
            where delivery.outbox_id = item.id and delivery.state = 'queued'));
$$;
revoke all on function public.list_gate2_offer_push_dispatchable()
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_offer_push_dispatchable() to service_role;

create function public.prepare_gate2_offer_push_deliveries(supplied_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    item internal.gate2_offer_push_outbox%rowtype;
    offer public.invites%rowtype;
begin
    select * into item from internal.gate2_offer_push_outbox where id = supplied_outbox_id;
    if not found then return '[]'::jsonb; end if;
    select * into offer from public.invites where id = item.invite_id for update;
    select * into item from internal.gate2_offer_push_outbox
        where id = supplied_outbox_id for update;
    if not found or not internal.gate2_offer_push_current(offer)
        or item.consent_receipt is distinct from
            internal.gate2_offer_push_consent_receipt(
                offer.respondent_id, offer.study_id)
    then return '[]'::jsonb; end if;
    insert into internal.gate2_offer_push_deliveries
        (outbox_id, subscription_id, endpoint_hash)
    select item.id, subscription.id,
        sha256(convert_to(subscription.endpoint, 'UTF8'))
    from public.push_subscriptions as subscription
    where subscription.respondent_id = offer.respondent_id
    on conflict (outbox_id, endpoint_hash) do nothing;
    return (select coalesce(jsonb_agg(delivery.id order by delivery.id), '[]'::jsonb)
        from internal.gate2_offer_push_deliveries as delivery
        join public.push_subscriptions as subscription
            on subscription.id = delivery.subscription_id
        where delivery.outbox_id = item.id and delivery.state = 'queued'
            and subscription.respondent_id = offer.respondent_id);
end;
$$;
revoke all on function public.prepare_gate2_offer_push_deliveries(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.prepare_gate2_offer_push_deliveries(uuid) to service_role;

create function public.claim_gate2_offer_push_delivery(
    supplied_delivery_id uuid, supplied_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    item internal.gate2_offer_push_outbox%rowtype;
    delivery internal.gate2_offer_push_deliveries%rowtype;
    offer public.invites%rowtype;
    subscription public.push_subscriptions%rowtype;
begin
    if supplied_claim_id is null then return null; end if;
    select * into delivery from internal.gate2_offer_push_deliveries
        where id = supplied_delivery_id;
    if not found then return null; end if;
    select * into item from internal.gate2_offer_push_outbox
        where id = delivery.outbox_id;
    if not found then return null; end if;
    select * into offer from public.invites where id = item.invite_id for update;
    select * into delivery from internal.gate2_offer_push_deliveries
        where id = supplied_delivery_id for update;
    select * into subscription from public.push_subscriptions
        where id = delivery.subscription_id for share;
    if delivery.state <> 'queued'
        or not internal.gate2_offer_push_current(offer)
        or item.consent_receipt is distinct from
            internal.gate2_offer_push_consent_receipt(
                offer.respondent_id, offer.study_id)
        or subscription.respondent_id is distinct from offer.respondent_id
    then return null; end if;
    update internal.gate2_offer_push_deliveries
    set state = 'claimed', claim_id = supplied_claim_id,
        claimed_at = clock_timestamp() where id = delivery.id;
    return jsonb_build_object('deliveryId', delivery.id,
        'claimId', supplied_claim_id, 'inviteId', offer.id,
        'respondentId', offer.respondent_id, 'expiresAt', offer.expires_at,
        'endpoint', subscription.endpoint, 'keys', subscription.keys_json);
end;
$$;
revoke all on function public.claim_gate2_offer_push_delivery(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_offer_push_delivery(uuid, uuid) to service_role;

create function public.observe_gate2_offer_push_delivery(
    supplied_delivery_id uuid, supplied_claim_id uuid, supplied_state text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare delivery internal.gate2_offer_push_deliveries%rowtype;
begin
    if supplied_state is null or supplied_state not in ('sent', 'failed')
    then return false; end if;
    select * into delivery from internal.gate2_offer_push_deliveries
        where id = supplied_delivery_id for update;
    if not found or delivery.claim_id is distinct from supplied_claim_id
    then return false; end if;
    if delivery.state = supplied_state then return true; end if;
    if delivery.state <> 'claimed' then return false; end if;
    update internal.gate2_offer_push_deliveries set state = supplied_state,
        observed_at = clock_timestamp() where id = delivery.id;
    return true;
end;
$$;
revoke all on function public.observe_gate2_offer_push_delivery(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.observe_gate2_offer_push_delivery(uuid, uuid, text)
    to service_role;
