-- Only a separately provisioned mock issuer may mint a fictional payout or
-- referral origin. This role has no login or membership in the migration;
-- protected preview must provision its credential explicitly.
create role gate2_fictional_issuer nologin;

revoke execute on function public.mark_gate2_fictional_payout(uuid)
    from service_role;
revoke execute on function public.mark_gate2_fictional_referral(uuid)
    from service_role;
revoke execute on function public.record_gate2_fictional_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz)
    from service_role;
grant execute on function public.mark_gate2_fictional_payout(uuid)
    to gate2_fictional_issuer;
grant execute on function public.mark_gate2_fictional_referral(uuid)
    to gate2_fictional_issuer;
grant execute on function public.record_gate2_fictional_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz)
    to gate2_fictional_issuer;

-- The generic service caller can still claim TEST origin. Only the separate
-- role may request fictional, and no service role is a member of that role.
grant execute on function public.claim_gate2_payout_issuer(uuid, text)
    to gate2_fictional_issuer;

create or replace function public.claim_gate2_payout_issuer(
    supplied_payout_id uuid, supplied_origin text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    payout public.payouts%rowtype;
    intent internal.gate2_sandbox_visa_intents%rowtype;
    prior internal.gate2_payout_issuer_claims%rowtype;
begin
    if supplied_origin not in ('test_provider', 'fictional') then return false; end if;
    if supplied_origin = 'fictional' and
        current_setting('role', true) <> 'gate2_fictional_issuer'
    then return false; end if;
    select * into payout from public.payouts
    where id = supplied_payout_id for update;
    if not found then return false; end if;
    select * into intent from internal.gate2_sandbox_visa_intents
    where payout_id = payout.id;
    if not found then return false; end if;
    select * into prior from internal.gate2_payout_issuer_claims
    where payout_id = payout.id;
    if found then return prior.origin = supplied_origin; end if;
    if payout.state <> 'pending' or payout.tremendous_order_id is not null
        or exists (select 1 from public.gate2_payout_events
            where payout_id = payout.id)
        or (supplied_origin = 'test_provider' and (
            exists (select 1 from internal.gate2_fictional_payouts
                where payout_id = payout.id)
            or (intent.referral_vesting_id is not null and exists (
                select 1 from internal.gate2_fictional_referrals
                where vesting_id = intent.referral_vesting_id))
            or (intent.batch_id is not null and exists (
                select 1 from internal.gate2_visa_reward_batch_referrals as source
                join internal.gate2_fictional_referrals as marker
                    on marker.vesting_id = source.vesting_id
                where source.batch_id = intent.batch_id))))
    then return false; end if;
    insert into internal.gate2_payout_issuer_claims (payout_id, origin)
    values (payout.id, supplied_origin);
    if supplied_origin = 'fictional' then
        insert into internal.gate2_fictional_payouts (payout_id)
        values (payout.id) on conflict do nothing;
        if intent.referral_vesting_id is not null then
            insert into internal.gate2_fictional_referrals (vesting_id)
            values (intent.referral_vesting_id) on conflict do nothing;
        end if;
    end if;
    return true;
end;
$$;


create or replace function internal.gate2_check_payout_observation_origin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
    perform 1 from public.payouts where id = new.payout_id for share;
    select origin into claimed from internal.gate2_payout_issuer_claims
    where payout_id = new.payout_id;
    new.observation_origin := case when
        current_setting('app.gate2_fictional_payout_observation', true) = 'fictional'
        then 'fictional' else 'test_provider' end;
    if new.observation_origin = 'fictional' and
        current_setting('role', true) <> 'gate2_fictional_issuer'
    then raise check_violation using message = 'fictional issuer role required'; end if;
    if claimed = 'fictional' and new.observation_origin <> 'fictional'
        or claimed = 'test_provider' and new.observation_origin <> 'test_provider'
        or claimed is null and new.observation_origin = 'fictional'
    then raise check_violation using message = 'payout observation origin mismatch'; end if;
    return new;
end;
$$;


create or replace function public.record_gate2_payout_observation(
    requested_payout_id uuid, requested_event_id text, requested_order_id text,
    requested_kind text, requested_amount_cents integer,
    requested_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed text;
declare observed_origin text;
begin
    select origin into claimed from internal.gate2_payout_issuer_claims
    where payout_id = requested_payout_id;
    observed_origin := case when
        current_setting('app.gate2_fictional_payout_observation', true) = 'fictional'
        then 'fictional' else 'test_provider' end;
    if observed_origin = 'fictional' and
        current_setting('role', true) <> 'gate2_fictional_issuer'
    then return false; end if;
    if claimed = 'fictional' and observed_origin <> 'fictional'
        or claimed = 'test_provider' and observed_origin <> 'test_provider'
        or claimed is null and observed_origin = 'fictional'
    then return false; end if;
    return internal.record_gate2_payout_observation(
        requested_payout_id, requested_event_id, requested_order_id,
        requested_kind, requested_amount_cents, requested_observed_at);
end;
$$;
