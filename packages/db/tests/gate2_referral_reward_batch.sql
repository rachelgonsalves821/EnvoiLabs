begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Rolled back with this fixture; production grants stay minimal.
grant usage on schema extensions to gate2_fictional_issuer;
grant execute on all functions in schema extensions to gate2_fictional_issuer;
grant gate2_fictional_issuer to postgres;

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
select format('a9880000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    '90100000-0000-4000-8000-000000000001',
    'Synthetic Visa batch study ' || n, 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '3 days'
from generate_series(1, 4) as n;
insert into public.brief_versions (study_id, version, brief_json, created_by)
select id, 1, '{}', '90400000-0000-4000-8000-000000000001'
from public.studies where id::text like 'a9880000-0000-4000-8000-%';
insert into public.guide_questions (id, study_id, position, text)
select format('a9890000-0000-4000-8000-%s',
        lpad((n * 10 + position)::text, 12, '0'))::uuid,
    format('a9880000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    position, 'Core question ' || position
from generate_series(1, 4) as n cross join generate_series(1, 5) as position;
set local role service_role;
select is(count(public.freeze_gate2_marketplace_quote(id, 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001')), 4::bigint,
    'four studies have frozen marketplace quotes')
from public.studies where id::text like 'a9880000-0000-4000-8000-%';
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_batch_' || study_id::text,
    'paid:batch:' || study_id::text, 'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id::text like 'a9880000-0000-4000-8000-%';
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
select format('a98a0000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    format('a9880000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    '90500000-0000-4000-8000-000000000001', 'accepted', 500,
    clock_timestamp() + interval '1 day'
from generate_series(1, 4) as n;
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
select format('a98b0000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    format('a98a0000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    format('a9880000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    'quality_hold', now() - interval '2 days 1 hour',
    case when n = 4 then now() - interval '1 hour'
        else now() - interval '2 days' end
from generate_series(1, 4) as n;
insert into public.quality_scores (session_id, score, components_json,
    decision, decided_by)
select id, 80, '{}'::jsonb, 'approve',
    '90400000-0000-4000-8000-000000000001'
from public.sessions where study_id::text like 'a9880000-0000-4000-8000-%';
update public.sessions set state = 'approved'
where study_id::text like 'a9880000-0000-4000-8000-%';
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence)
select format('a98c0000-0000-4000-8000-%s',
        lpad((n * 10 + position)::text, 12, '0'))::uuid,
    format('a98b0000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    format('a9880000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    format('a9890000-0000-4000-8000-%s',
        lpad((n * 10 + position)::text, 12, '0'))::uuid,
    'text', position
from generate_series(1, 4) as n cross join generate_series(1, 3) as position;
insert into public.transcripts (answer_id, study_id, provider, model,
    latency_ms, cost_micros)
select id, study_id, 'respondent', 'typed', 0, 0 from public.answers
where study_id::text like 'a9880000-0000-4000-8000-%';
insert into pii.transcript_raw (transcript_id, raw_text)
select id, 'Synthetic substantive answer' from public.transcripts
where study_id::text like 'a9880000-0000-4000-8000-%';
insert into internal.gate2_sandbox_visa_routes
    (respondent_id, recipient_name, recipient_email, country, verification_receipt)
values ('90500000-0000-4000-8000-000000000001', 'Synthetic Batch Person',
    'batch@example.test', 'US', 'synthetic:batch_route_1');
insert into internal.gate2_sandbox_visa_products
    (country, product_id, minimum_cents, maximum_cents, catalog_receipt)
values ('US', 'sandbox_visa', 1000, 50000, 'synthetic:batch_catalog_1');

-- Four approved $3 source rewards plus one independently vested $5 bonus.
update public.sessions set submitted_at = now() - interval '2 days'
where id = 'a98b0000-0000-4000-8000-000000000004';
alter table internal.gate2_sandbox_visa_products
    disable trigger immutable_gate2_sandbox_visa_products;
update internal.gate2_sandbox_visa_products set minimum_cents = 1500
where country = 'US';
alter table internal.gate2_sandbox_visa_products
    enable trigger immutable_gate2_sandbox_visa_products;
insert into public.referrals (referrer_id, referee_id, state)
select '90500000-0000-4000-8000-000000000001',
    format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    'profile_pending' from generate_series(2, 6) as n;
insert into public.gate2_referral_profile_verifications
    (referral_id, referrer_id, referee_id,
    normalized_email_hash, profile_digest)
select referral.id, referral.referrer_id, referral.referee_id,
    sha256(convert_to('batch-referral-' || referral.referee_id, 'UTF8')),
    sha256(convert_to('batch-profile-' || referral.referee_id, 'UTF8'))
from public.referrals as referral
where referral.referrer_id = '90500000-0000-4000-8000-000000000001';
insert into public.gate2_referral_vestings
    (id, referrer_id, verified_profile_count, bonus_cents, idempotency_key)
values ('a98e0000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 5, 500,
    'gate2-referral-bonus:90500000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_current_respondent_earnings()
    -> 'referral' ->> 'simulationProvenance', 'unverified',
    'a vesting without a mock receipt does not claim real provenance');
reset role;
select ok(not has_table_privilege('service_role',
    'internal.gate2_visa_reward_batch_referrals', 'INSERT'),
    'only the respondent-locked batch RPC can claim a vesting');
set local role service_role;
select ok(not has_function_privilege('service_role',
    'public.mark_gate2_fictional_referral(uuid)', 'EXECUTE'),
    'generic service caller cannot mark fictional referral');
set local role gate2_fictional_issuer;
select is(public.mark_gate2_fictional_referral(
    'a98e0000-0000-4000-8000-000000000001'), true,
    'fictional referral vesting is marked before a mock order');
select is(public.mark_gate2_fictional_referral(
    'a98e0000-0000-4000-8000-000000000001'), true,
    'fictional referral marker replay is idempotent');
set local role service_role;
create temporary table reserved_referral_batch (value jsonb not null);
grant select, insert on reserved_referral_batch to service_role;
grant select on reserved_referral_batch to gate2_fictional_issuer;
insert into reserved_referral_batch select public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000);
select is((select value ->> 'amountCents' from reserved_referral_batch), '1700',
    'four $3 rewards and the vested $5 bonus reach the $15 Visa floor');
select is(public.claim_gate2_payout_issuer((select
    (value ->> 'payoutId')::uuid from reserved_referral_batch),
    'test_provider'), false,
    'TEST issuer cannot take a batch with a fictional referral source');
set local role gate2_fictional_issuer;
select is(public.claim_gate2_payout_issuer((select
    (value ->> 'payoutId')::uuid from reserved_referral_batch), 'fictional'),
    true, 'the batch freezes fictional issuer and referral origin together');
set local role service_role;
select is(public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000)
    ->> 'payoutId', (select value ->> 'payoutId' from reserved_referral_batch),
    'batch retry returns the same provider identity');
select throws_ok($$select public.reserve_gate2_sandbox_visa_referral_bonus(
    'a98e0000-0000-4000-8000-000000000001', 200000)$$,
    '23514', null, 'direct referral path cannot double claim the batched bonus');
reset role;
select is((select count(*) from internal.gate2_visa_reward_batch_referrals
    where vesting_id = 'a98e0000-0000-4000-8000-000000000001'),
    1::bigint, 'one immutable bonus item belongs to the provider batch');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_current_respondent_earnings()
    -> 'referral' ->> 'payoutStatus', 'pending',
    'respondent sees batched referral payout as pending');
select is(public.read_gate2_current_respondent_earnings()
    -> 'referral' ->> 'simulationProvenance', 'fictional',
    'direct referral receipt identifies its mock vesting');
select is((public.read_gate2_current_respondent_earnings()
    ->> 'earnedCents')::integer, 1200,
    'referral bonus stays distinct from earned question rewards');
reset role;
set local role gate2_fictional_issuer;
select is(public.record_gate2_fictional_sandbox_visa_observation(
    (select (value ->> 'payoutId')::uuid from reserved_referral_batch),
    (select (value ->> 'payoutId')::uuid from reserved_referral_batch),
    'sandbox_visa', 'evt_batch_bonus_delivered', 'ORDER-BATCH-BONUS-1',
    'delivered', 1700, '2026-11-26T07:00:00Z'), true,
    'verified provider event delivers combined sources once');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_current_respondent_earnings()
    -> 'referral' ->> 'payoutStatus', 'delivered',
    'referral delivery follows the shared provider observation');
select is(public.read_gate2_current_respondent_earnings()
    -> 'referral' ->> 'deliveredAt', '2026-11-26T07:00:00+00:00',
    'referral receipt shows the confirmed provider date');
reset role;
select * from finish();
rollback;

