begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.gate2_quote_snapshots (id, study_id, brief_version, guide_digest,
    pricing_config_id, pricing_config_version, line_items_json, total_cents,
    incentive_cents_per_complete, feasibility_json)
select '99600000-0000-4000-8000-000000000010',
    '90600000-0000-4000-8000-000000000001', 1, repeat('a', 64), id, version,
    '[{"label":"Core questions","amountCents":500}]', 500, 200,
    '{"expectedCompletes":1,"hours":24}' from public.pricing_configs where active;

set local role authenticated;
select throws_ok($$select public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010')$$, '42501', null,
    'researcher cannot directly claim a provider create');
reset role;
set local role service_role;
select throws_ok($$select * from internal.gate2_checkout_intents$$,
    '42501', null, 'service role cannot read private intent rows directly');
select is(public.claim_gate2_checkout_intent(
    '00000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'status',
    'blocked', 'wrong study cannot claim quote');
select is(public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'status',
    'create', 'first call durably claims one create');
select is(public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'status',
    'unavailable', 'uncertain create stays unavailable during lease');
reset role;
select is((select idempotency_key from internal.gate2_checkout_intents),
    'gate2-checkout:99600000-0000-4000-8000-000000000010',
    'intent stores deterministic quote key');
update internal.gate2_checkout_intents set lease_expires_at = now() - interval '1 second';
set local role service_role;
select is(public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'key',
    'gate2-checkout:99600000-0000-4000-8000-000000000010',
    'bounded retry reuses original key');
reset role;
select is((select attempts from internal.gate2_checkout_intents), 2,
    'bounded retry increments durable attempt count');
update internal.gate2_checkout_intents set first_attempt_at = now() - interval '25 hours',
    lease_expires_at = now() - interval '1 hour';
set local role service_role;
select is(public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'status',
    'unavailable', 'retry after provider retention window cannot create again');
reset role;
select is((select attempts from internal.gate2_checkout_intents), 2,
    'late refusal does not consume another attempt');
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('99600000-0000-4000-8000-000000000010',
    '90600000-0000-4000-8000-000000000001', 'cs_test_known',
    'checkout-created:cs_test_known', 'checkout_created', 500, 'usd', now());
set local role service_role;
select is(public.claim_gate2_checkout_intent(
    '90600000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000010') ->> 'checkoutId',
    'cs_test_known', 'stored provider Session ID is returned even after retry window');
reset role;
select * from finish();
rollback;
