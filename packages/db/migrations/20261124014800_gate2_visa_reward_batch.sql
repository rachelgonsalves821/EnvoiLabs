-- Each approved session contributes its frozen earned cents at most once.
-- The payout row carries the whole batch for the existing cap/observation RPC.
create table internal.gate2_visa_reward_batches (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null unique references public.payouts (id),
    respondent_id uuid not null references public.respondents (id),
    amount_cents integer not null check (amount_cents > 0),
    created_at timestamptz not null default now()
);
create table internal.gate2_visa_reward_batch_items (
    batch_id uuid not null references internal.gate2_visa_reward_batches (id),
    session_id uuid not null unique references public.sessions (id),
    quote_id uuid not null references public.gate2_quote_snapshots (id),
    earned_cents integer not null check (earned_cents > 0),
    primary key (batch_id, session_id)
);
revoke all on internal.gate2_visa_reward_batches,
    internal.gate2_visa_reward_batch_items
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_visa_reward_batches before update or delete
    on internal.gate2_visa_reward_batches for each row
    execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_visa_reward_batch_items before update or delete
    on internal.gate2_visa_reward_batch_items for each row
    execute function internal.reject_gate2_ledger_mutation();

-- A legacy single-session reservation cannot claim a session already captured
-- by a batch. Both writers acquire the respondent row lock before this check.
create function internal.gate2_reject_batched_session_payout()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.session_id is not null and exists (
        select 1 from internal.gate2_visa_reward_batch_items
        where session_id = new.session_id)
    then raise check_violation using message = 'session earnings already batched'; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_reject_batched_session_payout()
    from public, anon, authenticated, service_role;
create trigger reject_batched_session_payout before insert on public.payouts
    for each row execute function internal.gate2_reject_batched_session_payout();

alter table internal.gate2_sandbox_visa_intents
    alter column session_id drop not null,
    add column batch_id uuid unique references internal.gate2_visa_reward_batches (id),
    add constraint sandbox_visa_one_payout_source
        check ((session_id is null) <> (batch_id is null));

create function public.reserve_gate2_sandbox_visa_batch(
    requested_respondent_id uuid, requested_request_id uuid,
    annual_cap_cents integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    route internal.gate2_sandbox_visa_routes%rowtype;
    product internal.gate2_sandbox_visa_products%rowtype;
    existing public.payouts%rowtype;
    existing_batch internal.gate2_visa_reward_batches%rowtype;
    candidate record;
    sessions uuid[] := '{}';
    quotes uuid[] := '{}';
    rewards integer[] := '{}';
    total integer := 0;
    seen integer := 0;
    batch_id uuid := gen_random_uuid();
    reserved_payout_id uuid;
    stable_key text;
    delivered_cents bigint;
    outstanding_cents bigint;
    current_year integer;
    position integer;
begin
    if requested_respondent_id is null or requested_request_id is null
        or annual_cap_cents is null or annual_cap_cents <= 0
        or annual_cap_cents > 200000
    then raise check_violation; end if;
    stable_key := 'visa-batch:' || requested_respondent_id::text || ':'
        || requested_request_id::text;
    perform 1 from public.respondents
    where id = requested_respondent_id and status = 'active' for update;
    if not found then raise check_violation; end if;
    select * into existing from public.payouts
    where idempotency_key = stable_key for update;
    if found then
        select * into existing_batch from internal.gate2_visa_reward_batches
        where payout_id = existing.id;
        if not found or existing.respondent_id is distinct from requested_respondent_id
            or existing.amount_cents is distinct from existing_batch.amount_cents
        then raise check_violation; end if;
        return jsonb_build_object('status', 'reserved', 'payoutId', existing.id,
            'batchId', existing_batch.id, 'amountCents', existing.amount_cents,
            'payoutState', existing.state, 'providerOrderId',
            existing.tremendous_order_id);
    end if;
    select * into route from internal.gate2_sandbox_visa_routes
    where respondent_id = requested_respondent_id;
    if not found then raise check_violation using message = 'sandbox recipient absent'; end if;
    select * into product from internal.gate2_sandbox_visa_products
    where country = route.country;
    if not found then raise check_violation using message = 'sandbox Visa SKU absent'; end if;

    for candidate in
        select interview.id as session_id,
            internal.gate2_marketplace_earned_cents(interview.id) as earned_cents,
            (select quote.id from public.gate2_quote_snapshots as quote
                where quote.study_id = interview.study_id
                    and quote.pricing_config_version >= 101
                    and exists (select 1 from public.gate2_payment_events as paid
                        where paid.quote_id = quote.id and paid.event_kind = 'paid')
                order by quote.created_at desc, quote.id desc limit 1) as quote_id
        from public.sessions as interview
        join public.invites as offer on offer.id = interview.invite_id
        where offer.respondent_id = requested_respondent_id
            and interview.state = 'approved'
            and interview.submitted_at <= now() - interval '24 hours'
            and not exists (select 1 from public.payouts as direct
                where direct.session_id = interview.id)
            and not exists (select 1 from internal.gate2_visa_reward_batch_items as claimed
                where claimed.session_id = interview.id)
        order by interview.submitted_at, interview.id limit 101
    loop
        seen := seen + 1;
        if seen > 100 then raise check_violation using message = 'batch candidate limit'; end if;
        if candidate.earned_cents is null or candidate.quote_id is null then continue; end if;
        if candidate.earned_cents > product.maximum_cents then continue; end if;
        if total + candidate.earned_cents <= product.maximum_cents then
            total := total + candidate.earned_cents;
            sessions := array_append(sessions, candidate.session_id);
            quotes := array_append(quotes, candidate.quote_id);
            rewards := array_append(rewards, candidate.earned_cents);
        end if;
    end loop;
    if total < product.minimum_cents then
        return jsonb_build_object('status', 'below_minimum',
            'minimumCents', product.minimum_cents);
    end if;
    current_year := extract(year from now() at time zone 'UTC')::integer;
    select coalesce(sum(amount_cents) filter (where state = 'delivered'
        and created_at >= make_timestamptz(current_year, 1, 1, 0, 0, 0, 'UTC')
        and created_at < make_timestamptz(current_year + 1, 1, 1, 0, 0, 0, 'UTC')), 0),
        coalesce(sum(amount_cents) filter (where state in ('pending', 'ordered')), 0)
        into delivered_cents, outstanding_cents
    from public.payouts where respondent_id = requested_respondent_id;
    if greatest(delivered_cents, (select case when ytd_payout_year = current_year
        then ytd_payout_cents else 0 end from public.respondents
        where id = requested_respondent_id)) + outstanding_cents + total >= annual_cap_cents
    then raise check_violation using message = 'annual payout cap'; end if;
    insert into public.payouts (bonus_ref, respondent_id, amount_cents,
        idempotency_key) values (batch_id, requested_respondent_id, total,
        stable_key) returning id into reserved_payout_id;
    insert into internal.gate2_visa_reward_batches
        (id, payout_id, respondent_id, amount_cents)
    values (batch_id, reserved_payout_id, requested_respondent_id, total);
    for position in 1..array_length(sessions, 1) loop
        insert into internal.gate2_visa_reward_batch_items
            (batch_id, session_id, quote_id, earned_cents)
        values (batch_id, sessions[position], quotes[position], rewards[position]);
    end loop;
    insert into internal.gate2_sandbox_visa_intents (payout_id, batch_id,
        respondent_id, amount_cents, recipient_name, recipient_email,
        country, product_id, verification_receipt, catalog_receipt)
    values (reserved_payout_id, batch_id, requested_respondent_id, total,
        route.recipient_name, route.recipient_email, route.country,
        product.product_id, route.verification_receipt, product.catalog_receipt);
    return jsonb_build_object('status', 'reserved', 'payoutId', reserved_payout_id,
        'batchId', batch_id, 'amountCents', total, 'payoutState', 'pending',
        'providerOrderId', null, 'sourceCount', array_length(sessions, 1));
end;
$$;
revoke all on function public.reserve_gate2_sandbox_visa_batch(uuid, uuid, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_sandbox_visa_batch(uuid, uuid, integer)
    to service_role;

-- Per-session Earnings keeps the source reward visible after it moves into a
-- batch. The delivered total sums item amounts, never the batch total twice.
create or replace function public.read_gate2_current_respondent_earnings()
returns jsonb language sql stable security definer set search_path = '' as $$
    with owner as (
        select id from public.respondents
        where auth_user_id = auth.uid() and status <> 'deleted'
    ), items as (
        select interview.id as session_id, interview.study_id,
            coalesce(payout.amount_cents,
                internal.gate2_marketplace_earned_cents(interview.id)) as earned_cents,
            coalesce(payout.state, 'awaiting_reservation') as payout_status,
            payout.id as payout_id, payout.batch_id,
            (select max(event.provider_observed_at)
                from public.gate2_payout_events as event
                where event.payout_id = payout.id and event.event_kind = 'delivered')
                as delivered_at
        from owner
        join public.invites as offer on offer.respondent_id = owner.id
        join public.sessions as interview on interview.invite_id = offer.id
        left join lateral (
            select direct.id, direct.amount_cents, direct.state,
                null::uuid as batch_id
            from public.payouts as direct where direct.session_id = interview.id
            union all
            select batch_payout.id, source.earned_cents,
                batch_payout.state, batch.id
            from internal.gate2_visa_reward_batch_items as source
            join internal.gate2_visa_reward_batches as batch
                on batch.id = source.batch_id
            join public.payouts as batch_payout on batch_payout.id = batch.payout_id
            where source.session_id = interview.id
            limit 1
        ) as payout on true
        where interview.state in ('approved', 'paid')
            and exists (select 1 from public.gate2_quote_snapshots as quote
                join public.gate2_payment_events as paid
                    on paid.quote_id = quote.id and paid.event_kind = 'paid'
                where quote.study_id = interview.study_id
                    and quote.pricing_config_version >= 101)
    ), totals as (
        select coalesce(sum(earned_cents) filter (where earned_cents > 0), 0)::integer
                as earned_cents,
            coalesce(sum(earned_cents) filter (
                where payout_status = 'delivered'), 0)::integer as delivered_cents,
            coalesce(jsonb_agg(jsonb_build_object(
                'sessionId', session_id, 'studyId', study_id,
                'earnedCents', earned_cents, 'payoutStatus', payout_status,
                'payoutId', payout_id, 'batchId', batch_id,
                'deliveredAt', delivered_at)
                order by session_id) filter (where earned_cents > 0), '[]'::jsonb)
                as sessions
        from items
    )
    select jsonb_build_object('currency', 'usd',
        'earnedCents', totals.earned_cents,
        'deliveredCents', totals.delivered_cents,
        'sessions', totals.sessions,
        'referral', jsonb_build_object(
            'verifiedProfiles', (select count(*) from
                public.gate2_referral_profile_verifications as verified
                where verified.referrer_id = owner.id),
            'vestedBonusCents', coalesce((select bonus_cents from
                public.gate2_referral_vestings as vested
                where vested.referrer_id = owner.id), 0)))
    from owner cross join totals;
$$;
