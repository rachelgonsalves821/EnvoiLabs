-- A provider lookup/create is permitted only after one immutable issuer
-- claim. The first caller owns the payout's TEST-versus-fictional identity.
create table internal.gate2_payout_issuer_claims (
    payout_id uuid primary key references public.payouts (id),
    origin text not null check (origin in ('test_provider', 'fictional')),
    claimed_at timestamptz not null default clock_timestamp()
);
alter table internal.gate2_payout_issuer_claims enable row level security;
revoke all on internal.gate2_payout_issuer_claims
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_payout_issuer_claims before update or delete
    on internal.gate2_payout_issuer_claims for each row
    execute function internal.reject_gate2_ledger_mutation();

create function public.claim_gate2_payout_issuer(
    supplied_payout_id uuid, supplied_origin text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    payout public.payouts%rowtype;
    intent internal.gate2_sandbox_visa_intents%rowtype;
    prior internal.gate2_payout_issuer_claims%rowtype;
begin
    if supplied_origin not in ('test_provider', 'fictional') then return false; end if;
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
revoke all on function public.claim_gate2_payout_issuer(uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_payout_issuer(uuid, text)
    to service_role;

-- Legacy marker RPCs cannot mint a new identity after an uncertain create.
create or replace function public.mark_gate2_fictional_payout(supplied_payout_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from internal.gate2_payout_issuer_claims
        where payout_id = supplied_payout_id and origin = 'fictional');
$$;
create or replace function public.mark_gate2_fictional_referral(supplied_vesting_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare saved public.payouts%rowtype;
begin
    perform 1 from public.gate2_referral_vestings
    where id = supplied_vesting_id for update;
    if not found then return false; end if;
    if exists (select 1 from internal.gate2_fictional_referrals
        where vesting_id = supplied_vesting_id) then return true; end if;
    select * into saved from public.payouts where bonus_ref = supplied_vesting_id;
    if found or exists (select 1 from internal.gate2_visa_reward_batch_referrals
        where vesting_id = supplied_vesting_id)
    then return false; end if;
    insert into internal.gate2_fictional_referrals (vesting_id)
    values (supplied_vesting_id) on conflict do nothing;
    return true;
end;
$$;

alter table public.gate2_payout_events add column observation_origin text
    not null default 'test_provider'
    check (observation_origin in ('test_provider', 'fictional'));
create function internal.gate2_check_payout_observation_origin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
    perform 1 from public.payouts where id = new.payout_id for share;
    select origin into claimed from internal.gate2_payout_issuer_claims
    where payout_id = new.payout_id;
    new.observation_origin := case when
        current_setting('app.gate2_fictional_payout_observation', true) = 'fictional'
        then 'fictional' else 'test_provider' end;
    if claimed = 'fictional' and new.observation_origin <> 'fictional'
        or claimed = 'test_provider' and new.observation_origin <> 'test_provider'
        or claimed is null and new.observation_origin = 'fictional'
    then raise check_violation using message = 'payout observation origin mismatch'; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_check_payout_observation_origin()
    from public, anon, authenticated, service_role;
create trigger gate2_check_payout_observation_origin before insert
    on public.gate2_payout_events for each row
    execute function internal.gate2_check_payout_observation_origin();

-- The original reconciliation function also handles an exact event replay
-- before INSERT. Guard that path as well, including direct service RPC calls.
alter function public.record_gate2_payout_observation(
    uuid, text, text, text, integer, timestamptz) set schema internal;
revoke all on function internal.record_gate2_payout_observation(
    uuid, text, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
create function public.record_gate2_payout_observation(
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
    if claimed = 'fictional' and observed_origin <> 'fictional'
        or claimed = 'test_provider' and observed_origin <> 'test_provider'
        or claimed is null and observed_origin = 'fictional'
    then return false; end if;
    return internal.record_gate2_payout_observation(
        requested_payout_id, requested_event_id, requested_order_id,
        requested_kind, requested_amount_cents, requested_observed_at);
end;
$$;
revoke all on function public.record_gate2_payout_observation(
    uuid, text, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate2_payout_observation(
    uuid, text, text, text, integer, timestamptz) to service_role;

create function public.record_gate2_fictional_sandbox_visa_observation(
    requested_payout_id uuid, requested_recipient_id uuid,
    requested_product_id text, requested_event_id text,
    requested_order_id text, requested_kind text,
    requested_amount_cents integer, requested_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare result boolean;
begin
    if not exists (select 1 from internal.gate2_payout_issuer_claims
        where payout_id = requested_payout_id and origin = 'fictional')
    then return false; end if;
    perform set_config('app.gate2_fictional_payout_observation', 'fictional', true);
    result := public.record_gate2_sandbox_visa_observation(
        requested_payout_id, requested_recipient_id, requested_product_id,
        requested_event_id, requested_order_id, requested_kind,
        requested_amount_cents, requested_observed_at);
    perform set_config('app.gate2_fictional_payout_observation', '', true);
    return result;
end;
$$;
revoke all on function public.record_gate2_fictional_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate2_fictional_sandbox_visa_observation(
    uuid, uuid, text, text, text, text, integer, timestamptz) to service_role;
