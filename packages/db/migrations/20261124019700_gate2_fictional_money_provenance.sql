-- A fictional provider adapter must mark the frozen source before creating
-- mock payment or delivery observations. Markers can only be added, never
-- removed, so turning off a preview flag cannot turn a mock into real money.
create table internal.gate2_fictional_quotes (
    quote_id uuid primary key references public.gate2_quote_snapshots (id),
    marked_at timestamptz not null default clock_timestamp()
);
create table internal.gate2_fictional_payouts (
    payout_id uuid primary key references public.payouts (id),
    marked_at timestamptz not null default clock_timestamp()
);
create table internal.gate2_fictional_referrals (
    vesting_id uuid primary key references public.gate2_referral_vestings (id),
    marked_at timestamptz not null default clock_timestamp()
);
alter table internal.gate2_fictional_quotes enable row level security;
alter table internal.gate2_fictional_payouts enable row level security;
alter table internal.gate2_fictional_referrals enable row level security;
revoke all on internal.gate2_fictional_quotes,
    internal.gate2_fictional_payouts, internal.gate2_fictional_referrals
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_fictional_quotes before update or delete
    on internal.gate2_fictional_quotes for each row
    execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_fictional_payouts before update or delete
    on internal.gate2_fictional_payouts for each row
    execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_fictional_referrals before update or delete
    on internal.gate2_fictional_referrals for each row
    execute function internal.reject_gate2_ledger_mutation();

create function public.mark_gate2_fictional_quote(supplied_quote_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare frozen public.gate2_quote_snapshots%rowtype;
begin
    select * into frozen from public.gate2_quote_snapshots
    where id = supplied_quote_id for update;
    if not found then return false; end if;
    if exists (select 1 from internal.gate2_fictional_quotes
        where quote_id = supplied_quote_id) then return true; end if;
    if exists (select 1 from public.gate2_payment_events
        where quote_id = supplied_quote_id)
        or exists (select 1 from internal.gate2_checkout_intents
            where quote_id = supplied_quote_id)
    then return false; end if;
    insert into internal.gate2_fictional_quotes (quote_id)
    values (supplied_quote_id) on conflict (quote_id) do nothing;
    return true;
end;
$$;
revoke all on function public.mark_gate2_fictional_quote(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.mark_gate2_fictional_quote(uuid) to service_role;

create function public.read_gate2_fictional_quote(supplied_quote_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from internal.gate2_fictional_quotes
        where quote_id = supplied_quote_id);
$$;
revoke all on function public.read_gate2_fictional_quote(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_fictional_quote(uuid) to service_role;

-- The row lock orders a provider observation against fictional marking.
-- Once a quote is fictional, a real provider observation can never turn it
-- into a paid real-money study, even through a direct service-role INSERT.
alter table public.gate2_payment_events add column observation_origin text
    not null default 'provider' check (observation_origin in ('provider', 'fictional'));
create function internal.gate2_check_payment_observation_origin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_fictional boolean;
begin
    perform 1 from public.gate2_quote_snapshots
    where id = new.quote_id for share;
    select exists (select 1 from internal.gate2_fictional_quotes
        where quote_id = new.quote_id) into is_fictional;
    if is_fictional is distinct from (new.observation_origin = 'fictional')
    then raise check_violation using message = 'payment observation origin mismatch'; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_check_payment_observation_origin()
    from public, anon, authenticated, service_role;
create trigger gate2_check_payment_observation_origin
    before insert on public.gate2_payment_events for each row
    execute function internal.gate2_check_payment_observation_origin();

create function public.mark_gate2_fictional_payout(supplied_payout_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
    perform 1 from public.payouts where id = supplied_payout_id for update;
    if not found then return false; end if;
    if exists (select 1 from internal.gate2_fictional_payouts
        where payout_id = supplied_payout_id) then return true; end if;
    if not exists (select 1 from internal.gate2_sandbox_visa_intents
        where payout_id = supplied_payout_id)
        or exists (select 1 from public.gate2_payout_events
            where payout_id = supplied_payout_id)
    then return false; end if;
    insert into internal.gate2_fictional_payouts (payout_id)
    values (supplied_payout_id) on conflict (payout_id) do nothing;
    return true;
end;
$$;
revoke all on function public.mark_gate2_fictional_payout(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.mark_gate2_fictional_payout(uuid) to service_role;

create function public.mark_gate2_fictional_referral(supplied_vesting_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
    perform 1 from public.gate2_referral_vestings
        where id = supplied_vesting_id for update;
    if not found then return false; end if;
    insert into internal.gate2_fictional_referrals (vesting_id)
    values (supplied_vesting_id) on conflict (vesting_id) do nothing;
    return true;
end;
$$;
revoke all on function public.mark_gate2_fictional_referral(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.mark_gate2_fictional_referral(uuid) to service_role;

-- Direct table readers cannot omit the provenance field while selecting a
-- payout amount or delivery state. Current Earnings remains the private read.
revoke select (amount_cents, state) on public.payouts from authenticated;

alter function public.read_gate2_current_researcher_receipt(uuid)
    set schema internal;
revoke all on function internal.read_gate2_current_researcher_receipt(uuid)
    from public, anon, authenticated, service_role;
create function public.read_gate2_current_researcher_receipt(
    supplied_study_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    receipt jsonb;
    origin text;
begin
    receipt := internal.read_gate2_current_researcher_receipt(supplied_study_id);
    if receipt is null then return null; end if;
    origin := case when exists (
        select 1 from internal.gate2_fictional_quotes
        where quote_id = (receipt ->> 'quoteId')::uuid
    ) then 'fictional' else 'unverified' end;
    receipt := receipt || jsonb_build_object('simulationProvenance', origin);
    if receipt -> 'refund' <> 'null'::jsonb then
        receipt := jsonb_set(receipt, '{refund}',
            receipt -> 'refund' || jsonb_build_object(
                'simulationProvenance', origin));
    end if;
    return receipt;
end;
$$;
revoke all on function public.read_gate2_current_researcher_receipt(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_current_researcher_receipt(uuid)
    to authenticated;

alter function public.read_gate2_current_respondent_earnings()
    set schema internal;
revoke all on function internal.read_gate2_current_respondent_earnings()
    from public, anon, authenticated, service_role;
create function public.read_gate2_current_respondent_earnings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    earnings jsonb;
    sessions jsonb;
    fictional_referral boolean;
begin
    earnings := internal.read_gate2_current_respondent_earnings();
    if earnings is null then return null; end if;
    select coalesce(jsonb_agg(entry.item || jsonb_build_object(
        'simulationProvenance', case when exists (
            select 1 from internal.gate2_fictional_quotes as marker
            join public.gate2_quote_snapshots as quote
                on quote.id = marker.quote_id
            join public.gate2_payment_events as paid
                on paid.quote_id = quote.id and paid.event_kind = 'paid'
            where quote.study_id = (entry.item ->> 'studyId')::uuid
        ) or exists (
            select 1 from internal.gate2_fictional_payouts as marker
            where marker.payout_id = (entry.item ->> 'payoutId')::uuid
        ) then 'fictional' else 'unverified' end)
        order by entry.ordinality), '[]'::jsonb) into sessions
    from jsonb_array_elements(earnings -> 'sessions') with ordinality
        as entry(item, ordinality);
    select exists (select 1
        from public.respondents as respondent
        join public.gate2_referral_vestings as vesting
            on vesting.referrer_id = respondent.id
        left join internal.gate2_fictional_referrals as marker
            on marker.vesting_id = vesting.id
        left join public.payouts as payout on payout.bonus_ref = vesting.id
        left join internal.gate2_fictional_payouts as payout_marker
            on payout_marker.payout_id = payout.id
        left join internal.gate2_visa_reward_batch_referrals as batch_source
            on batch_source.vesting_id = vesting.id
        left join internal.gate2_visa_reward_batches as batch
            on batch.id = batch_source.batch_id
        left join internal.gate2_fictional_payouts as batch_marker
            on batch_marker.payout_id = batch.payout_id
        where respondent.auth_user_id = auth.uid()
            and (marker.vesting_id is not null
                or payout_marker.payout_id is not null
                or batch_marker.payout_id is not null))
    into fictional_referral;
    earnings := jsonb_set(earnings, '{sessions}', sessions);
    earnings := jsonb_set(earnings, '{referral}',
        earnings -> 'referral' || jsonb_build_object(
            'simulationProvenance', case when fictional_referral
                then 'fictional' else 'unverified' end));
    return earnings || jsonb_build_object('containsFictionalMoney',
        fictional_referral or exists (select 1 from jsonb_array_elements(sessions)
            as item(value) where item.value ->> 'simulationProvenance' = 'fictional'));
end;
$$;
revoke all on function public.read_gate2_current_respondent_earnings()
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_current_respondent_earnings()
    to authenticated;
