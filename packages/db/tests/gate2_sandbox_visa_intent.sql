begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9870000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic sandbox Visa', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9870000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (id, study_id, position, text)
select format('a9870000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'a9870000-0000-4000-8000-000000000001', n,
    'Core question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9870000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'payout uses a frozen paid marketplace quote');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_visa', 'paid:sandbox-visa',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9870000-0000-4000-8000-000000000001';
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 500,
    clock_timestamp() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
values ('a9870000-0000-4000-8000-000000000003',
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000001', 'quality_hold',
    now() - interval '2 days 1 hour', now() - interval '2 days');
insert into public.quality_scores (session_id, score, components_json,
    decision, decided_by) values (
    'a9870000-0000-4000-8000-000000000003', 80, '{}'::jsonb,
    'approve', '90400000-0000-4000-8000-000000000001');
update public.sessions set state = 'approved'
where id = 'a9870000-0000-4000-8000-000000000003';
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence)
select format('a9870000-0000-4000-8000-%s', lpad((n + 20)::text, 12, '0'))::uuid,
    'a9870000-0000-4000-8000-000000000003',
    'a9870000-0000-4000-8000-000000000001',
    format('a9870000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'text', n from generate_series(1, 3) as n;
insert into public.transcripts (answer_id, study_id, provider, model,
    latency_ms, cost_micros)
select id, study_id, 'respondent', 'typed', 0, 0 from public.answers
where session_id = 'a9870000-0000-4000-8000-000000000003';
insert into pii.transcript_raw (transcript_id, raw_text)
select id, 'Synthetic answered question' from public.transcripts
where study_id = 'a9870000-0000-4000-8000-000000000001';

select ok(not has_function_privilege('authenticated',
    'public.reserve_gate2_sandbox_visa_intent(uuid,integer)', 'EXECUTE'),
    'respondent cannot create a sandbox payout intent');
select ok(not has_function_privilege('authenticated',
    'public.read_gate2_sandbox_visa_recipient(uuid)', 'EXECUTE'),
    'respondent cannot read payout recipient PII');
select ok(not has_table_privilege('service_role',
    'internal.gate2_sandbox_visa_intents', 'INSERT'),
    'service cannot bypass the frozen intent RPC');
set local role service_role;
select throws_ok($$select public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000)$$,
    '23514', null, 'no synthetic verified route blocks reservation');
reset role;
insert into internal.gate2_sandbox_visa_routes
    (respondent_id, recipient_name, recipient_email, country, verification_receipt)
values ('90500000-0000-4000-8000-000000000001', 'Synthetic Person',
    'synthetic@example.test', 'US', 'synthetic:route_receipt_1');
insert into internal.gate2_sandbox_visa_products
    (country, product_id, minimum_cents, maximum_cents, catalog_receipt)
values ('US', 'sandbox_visa', 1000, 50000, 'synthetic:catalog_receipt_1');
set local role service_role;
select throws_ok($$select public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000)$$,
    '23514', null, 'three dollars cannot create a ten-dollar Visa order');
reset role;
select is((select count(*) from public.payouts where session_id =
    'a9870000-0000-4000-8000-000000000003'), 0::bigint,
    'below-minimum reward does not reserve an unpayable payout');
-- Synthetic catalog fixture permits a three-dollar product only to test the
-- frozen transaction. Real SKU minimum comes from the account catalog.
alter table internal.gate2_sandbox_visa_products
    disable trigger immutable_gate2_sandbox_visa_products;
update internal.gate2_sandbox_visa_products set minimum_cents = 300,
    catalog_receipt = 'synthetic:catalog_receipt_2' where country = 'US';
alter table internal.gate2_sandbox_visa_products
    enable trigger immutable_gate2_sandbox_visa_products;
set local role service_role;
create temporary table intent (value jsonb not null);
grant select, insert on intent to service_role;
insert into intent select public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000);
select is((select value ->> 'amountCents' from intent), '300',
    'intent freezes three answered core questions at three dollars');
select is((select value ->> 'productId' from intent), 'sandbox_visa',
    'intent binds account-selected synthetic Visa SKU');
select is(public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000),
    (select value from intent), 'retry returns the same frozen recipient and SKU');
select is((select public.read_gate2_sandbox_visa_recipient((value ->> 'id')::uuid)
    ->> 'email' from intent), 'synthetic@example.test',
    'private provider lookup reads only the frozen recipient');
select ok(not public.record_gate2_sandbox_visa_observation(
    (select (value ->> 'id')::uuid from intent),
    (select (value ->> 'id')::uuid from intent), 'wrong_product',
    'evt_wrong', 'ORDER-1', 'ordered', 300, '2026-11-25T02:00:00Z'),
    'wrong Visa SKU cannot be recorded');
select ok(public.record_gate2_sandbox_visa_observation(
    (select (value ->> 'id')::uuid from intent),
    (select (value ->> 'id')::uuid from intent), 'sandbox_visa',
    'evt_ordered', 'ORDER-1', 'ordered', 300, '2026-11-25T02:00:00Z'),
    'matching provider observation advances payout');
select is(public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000)
    ->> 'providerOrderId', 'ORDER-1',
    'retry returns the frozen order identity');
reset role;
update public.respondents set status = 'deleted'
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select is((select public.read_gate2_sandbox_visa_recipient(
    (value ->> 'id')::uuid) from intent), null::jsonb,
    'deletion state withholds the frozen recipient before provider lookup');
select throws_ok($$select public.reserve_gate2_sandbox_visa_intent(
    'a9870000-0000-4000-8000-000000000003', 200000)$$,
    '23514', null, 'deleted respondent cannot retry a sandbox order');
select * from finish();
rollback;
