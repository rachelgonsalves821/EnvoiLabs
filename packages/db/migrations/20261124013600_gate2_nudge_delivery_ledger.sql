-- Each browser subscription gets its own private, at-most-once delivery claim.
-- A claim with no final observation stays unresolved; no automatic retry can
-- send a second notification after an uncertain transport outcome.
create table internal.gate2_nudge_deliveries (
    id uuid primary key default gen_random_uuid(),
    outbox_id uuid not null references internal.gate2_nudge_outbox (id),
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
alter table internal.gate2_nudge_deliveries enable row level security;
revoke all on internal.gate2_nudge_deliveries from public, anon, authenticated, service_role;

create function public.list_gate2_nudge_dispatchable()
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(item.id order by item.created_at, item.id), '[]'::jsonb)
    from internal.gate2_nudge_outbox as item
    where not exists (select 1 from internal.gate2_nudge_deliveries as delivery
        where delivery.outbox_id = item.id)
        or exists (select 1 from internal.gate2_nudge_deliveries as delivery
            join public.push_subscriptions as subscription
                on subscription.id = delivery.subscription_id
            where delivery.outbox_id = item.id and delivery.state = 'queued');
$$;
revoke all on function public.list_gate2_nudge_dispatchable()
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_nudge_dispatchable() to service_role;

create function public.prepare_gate2_nudge_deliveries(supplied_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    item internal.gate2_nudge_outbox%rowtype;
    interview public.sessions%rowtype;
    offer public.invites%rowtype;
begin
    -- Match the queue's session -> offer lock order.
    select * into item from internal.gate2_nudge_outbox where id = supplied_outbox_id;
    if not found then return '[]'::jsonb; end if;
    select * into interview from public.sessions where id = item.session_id for update;
    select * into offer from public.invites where id = item.invite_id for update;
    select * into item from internal.gate2_nudge_outbox
        where id = supplied_outbox_id for update;
    if interview.state <> 'in_progress' or offer.state <> 'accepted'
        or offer.expires_at <= clock_timestamp()
        or (item.kind = 'halfway' and
            offer.expires_at <= clock_timestamp() + interval '2 hours')
        or not exists (select 1 from public.studies as study
            where study.id = offer.study_id and study.state = 'fielding')
        or not exists (select 1 from public.respondents as respondent
            where respondent.id = offer.respondent_id and respondent.status = 'active'
                and internal.gate1_consent(respondent.id, offer.study_id,
                    'push_notifications'))
        or exists (select 1 from internal.gate2_nudge_snoozes as snooze
            where snooze.invite_id = offer.id and snooze.until_at > clock_timestamp())
    then return '[]'::jsonb; end if;
    insert into internal.gate2_nudge_deliveries (outbox_id, subscription_id,
        endpoint_hash)
    select item.id, subscription.id,
        sha256(convert_to(subscription.endpoint, 'UTF8'))
    from public.push_subscriptions as subscription
    where subscription.respondent_id = offer.respondent_id
    on conflict (outbox_id, endpoint_hash) do nothing;
    return (select coalesce(jsonb_agg(delivery.id order by delivery.id), '[]'::jsonb)
        from internal.gate2_nudge_deliveries as delivery
        join public.push_subscriptions as subscription
            on subscription.id = delivery.subscription_id
        where delivery.outbox_id = item.id
            and subscription.respondent_id = offer.respondent_id);
end;
$$;
revoke all on function public.prepare_gate2_nudge_deliveries(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.prepare_gate2_nudge_deliveries(uuid) to service_role;

create function public.claim_gate2_nudge_delivery(
    supplied_delivery_id uuid, supplied_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    item internal.gate2_nudge_outbox%rowtype;
    delivery internal.gate2_nudge_deliveries%rowtype;
    interview public.sessions%rowtype;
    offer public.invites%rowtype;
    subscription public.push_subscriptions%rowtype;
begin
    if supplied_claim_id is null then return null; end if;
    select * into delivery from internal.gate2_nudge_deliveries
        where id = supplied_delivery_id;
    if not found then return null; end if;
    select * into item from internal.gate2_nudge_outbox where id = delivery.outbox_id;
    if not found then return null; end if;
    select * into interview from public.sessions where id = item.session_id for update;
    select * into offer from public.invites where id = item.invite_id for update;
    select * into delivery from internal.gate2_nudge_deliveries
        where id = supplied_delivery_id for update;
    select * into subscription from public.push_subscriptions
        where id = delivery.subscription_id for share;
    if delivery.state <> 'queued' or interview.state <> 'in_progress'
        or offer.state <> 'accepted' or offer.expires_at <= clock_timestamp()
        or (item.kind = 'halfway' and
            offer.expires_at <= clock_timestamp() + interval '2 hours')
        or subscription.respondent_id is distinct from offer.respondent_id
        or not exists (select 1 from public.studies as study
            where study.id = offer.study_id and study.state = 'fielding')
        or not exists (select 1 from public.respondents as respondent
            where respondent.id = offer.respondent_id and respondent.status = 'active'
                and internal.gate1_consent(respondent.id, offer.study_id,
                    'push_notifications'))
        or exists (select 1 from internal.gate2_nudge_snoozes as snooze
            where snooze.invite_id = offer.id and snooze.until_at > clock_timestamp())
    then return null; end if;
    update internal.gate2_nudge_deliveries
    set state = 'claimed', claim_id = supplied_claim_id,
        claimed_at = clock_timestamp()
    where id = delivery.id;
    return jsonb_build_object('deliveryId', delivery.id,
        'claimId', supplied_claim_id, 'inviteId', offer.id,
        'respondentId', offer.respondent_id, 'expiresAt', offer.expires_at,
        'kind', item.kind, 'endpoint', subscription.endpoint,
        'keys', subscription.keys_json);
end;
$$;
revoke all on function public.claim_gate2_nudge_delivery(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_nudge_delivery(uuid, uuid) to service_role;

create function public.observe_gate2_nudge_delivery(
    supplied_delivery_id uuid, supplied_claim_id uuid, supplied_state text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare delivery internal.gate2_nudge_deliveries%rowtype;
begin
    if supplied_state is null or supplied_state not in ('sent', 'failed')
    then return false; end if;
    select * into delivery from internal.gate2_nudge_deliveries
        where id = supplied_delivery_id for update;
    if not found or delivery.claim_id is distinct from supplied_claim_id
    then return false; end if;
    if delivery.state = supplied_state then return true; end if;
    if delivery.state <> 'claimed' then return false; end if;
    update internal.gate2_nudge_deliveries set state = supplied_state,
        observed_at = clock_timestamp() where id = delivery.id;
    return true;
end;
$$;
revoke all on function public.observe_gate2_nudge_delivery(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.observe_gate2_nudge_delivery(uuid, uuid, text) to service_role;
