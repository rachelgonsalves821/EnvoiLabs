begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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
    'approved', now() - interval '2 days 1 hour',
    case when n = 4 then now() - interval '1 hour'
        else now() - interval '2 days' end
from generate_series(1, 4) as n;
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

select ok(not has_function_privilege('authenticated',
    'public.reserve_gate2_sandbox_visa_batch(uuid,uuid,integer)', 'EXECUTE'),
    'respondent cannot create a payout batch');
select ok(not has_table_privilege('service_role',
    'internal.gate2_visa_reward_batch_items', 'INSERT'),
    'service cannot attach sessions outside the locking RPC');
set local role service_role;
select is(public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000) ->> 'status',
    'below_minimum', 'three held three-dollar rewards wait below ten dollars');
reset role;
select is((select count(*) from public.payouts
    where idempotency_key like 'visa-batch:%'), 0::bigint,
    'below-minimum attempt makes no payout reservation');
update public.sessions set submitted_at = now() - interval '2 days'
where id = 'a98b0000-0000-4000-8000-000000000004';
update public.respondents set ytd_payout_cents = 199000,
    ytd_payout_year = extract(year from now() at time zone 'UTC')::integer
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000)$$,
    '23514', null, 'batch is reserved against the annual cap as one payout');
reset role;
update public.respondents set ytd_payout_cents = 0
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
create temporary table reserved_batch (value jsonb not null);
grant select, insert on reserved_batch to service_role;
insert into reserved_batch select public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000);
select is((select value ->> 'amountCents' from reserved_batch), '1200',
    'four three-dollar rewards make one twelve-dollar Visa batch');
select is((select value ->> 'sourceCount' from reserved_batch), '4',
    'batch freezes four separate session receipts');
reset role;
select is((select count(*) from internal.gate2_visa_reward_batch_items),
    4::bigint, 'each source session is claimed exactly once');
set local role service_role;
select is(public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000001', 200000)
    ->> 'payoutId', (select value ->> 'payoutId' from reserved_batch),
    'stable request ID retries the same payout');
select is(public.reserve_gate2_sandbox_visa_batch(
    '90500000-0000-4000-8000-000000000001',
    'a98d0000-0000-4000-8000-000000000002', 200000) ->> 'status',
    'below_minimum', 'new request cannot claim already-batched earnings');
select throws_ok($$select public.reserve_gate2_session_payout(
    'a98b0000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 300, 200000,
    'payout:a98b0000-0000-4000-8000-000000000001')$$,
    '23514', null, 'older per-session path cannot pay a batched reward twice');
select is(public.record_gate2_sandbox_visa_observation(
    (select (value ->> 'payoutId')::uuid from reserved_batch),
    (select (value ->> 'payoutId')::uuid from reserved_batch),
    'sandbox_visa', 'evt_batch_delivered', 'ORDER-BATCH-1',
    'delivered', 1200, '2026-11-25T02:00:00Z'), true,
    'one verified provider event delivers the batch');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.read_gate2_current_respondent_earnings()
    ->> 'earnedCents')::integer, 1200,
    'Earnings sums each approved source reward once');
select is((public.read_gate2_current_respondent_earnings()
    ->> 'deliveredCents')::integer, 1200,
    'delivery total distributes one batch across four receipts');
select is((select count(distinct item ->> 'batchId')
    from jsonb_array_elements(public.read_gate2_current_respondent_earnings()
        -> 'sessions') as item), 1::bigint,
    'four respondent receipts share one batch identity');
select is((select count(*) from jsonb_array_elements(
    public.read_gate2_current_respondent_earnings() -> 'sessions') as item
    where item ->> 'payoutStatus' = 'delivered'
        and item ->> 'deliveredAt' = '2026-11-25T02:00:00+00:00'),
    4::bigint, 'each source receipt shows the provider delivery date');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.read_gate2_current_respondent_earnings()
    ->> 'deliveredCents')::integer, 0,
    'another respondent cannot read this batch delivery');
select * from finish();
rollback;
