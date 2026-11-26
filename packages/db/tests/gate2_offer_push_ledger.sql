begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
set local role service_role;
select throws_ok($$select public.list_gate2_offer_push_dispatchable()$$,
    '42501', 'permission denied for function list_gate2_offer_push_dispatchable',
    'old unbounded dispatch reader is no longer callable');
reset role;
-- Keep the historical ledger fixture focused on its original contract.
-- This grant lasts only for the rollback-only test transaction.
grant execute on function public.list_gate2_offer_push_dispatchable()
    to service_role;

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9870000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic push timing', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '1 day');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9870000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (id, study_id, position, text)
select format('a9870000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'a9870000-0000-4000-8000-000000000001', n,
    'Push question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9870000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'push test uses a paid frozen marketplace quote');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_push', 'paid:push',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9870000-0000-4000-8000-000000000001';
update public.studies set state = 'fielding'
where id = 'a9870000-0000-4000-8000-000000000001';
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at)
values ('a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'invited', 500,
    clock_timestamp() + interval '1 day');
insert into public.push_subscriptions (respondent_id, endpoint, keys_json, platform)
values ('90500000-0000-4000-8000-000000000001',
    'https://push.example.invalid/matched', '{}'::jsonb, 'web');
select ok(not has_function_privilege('authenticated',
    'public.queue_gate2_offer_push(uuid)', 'EXECUTE') and
    not has_function_privilege('authenticated',
        'public.claim_gate2_offer_push_delivery(uuid,uuid)', 'EXECUTE'),
    'respondents cannot enqueue or claim private matched-offer push');
set local role service_role;
select is(jsonb_array_length(public.list_gate2_offer_push_candidates()), 0,
    'subscription alone is not a push-purpose grant');
select ok(not public.queue_gate2_offer_push(
    'a9870000-0000-4000-8000-000000000002'),
    'missing consent cannot queue an offer notification');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', true, 'synthetic-offer-push-only');
set local role service_role;
select is(jsonb_array_length(public.list_gate2_offer_push_candidates()), 1,
    'paid fielding match with consent is one private candidate');
select ok(public.queue_gate2_offer_push(
    'a9870000-0000-4000-8000-000000000002'),
    'current matched offer enters the private queue');
select ok(public.queue_gate2_offer_push(
    'a9870000-0000-4000-8000-000000000002'),
    'queue replay keeps the same offer identity');
select is(jsonb_array_length(public.list_gate2_offer_push_candidates()), 0,
    'queued offer is no longer a candidate');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatchable()), 1,
    'one outbox entry is dispatchable');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatch_page(null)), 1,
    'bounded first page includes the queued outbox');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatch_page(
    (public.list_gate2_offer_push_dispatch_page(null) ->> 0)::uuid)), 0,
    'keyset cursor excludes the previous page');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatch_page(
    'a9870000-0000-4000-8000-000000000099')), 0,
    'unknown outbox cursor fails closed');
select is(jsonb_array_length(public.prepare_gate2_offer_push_deliveries(
    (public.list_gate2_offer_push_dispatchable() ->> 0)::uuid)), 1,
    'one subscription receives one prepared delivery');
reset role;
select is((select count(*) from internal.gate2_offer_push_outbox),
    1::bigint, 'exact queue replay created one outbox entry');
select throws_ok($$update internal.gate2_offer_push_outbox
    set consent_receipt = sha256(convert_to('tampered', 'UTF8'))$$,
    '23514', null, 'queued consent identity is immutable');
select is((select count(*) from internal.gate2_offer_push_deliveries),
    1::bigint, 'one endpoint hash is claimable');
update internal.gate2_offer_push_deliveries
set id = 'a9870000-0000-4000-8000-000000000021';
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', false, 'synthetic-offer-push-withdrawn');
set local role service_role;
select is(public.claim_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010'), null::jsonb,
    'withdrawal prevents a prepared offer notification claim');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', true, 'synthetic-offer-push-regrant');
set local role service_role;
select is(public.claim_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010'), null::jsonb,
    'regrant cannot resurrect the old consent-bound delivery');
select is(jsonb_array_length(public.list_gate2_offer_push_candidates()), 1,
    'a new grant may enqueue a fresh offer notification');
select ok(public.queue_gate2_offer_push(
    'a9870000-0000-4000-8000-000000000002'),
    'fresh consent gets a separate queued identity');
reset role;
select is((select count(*) from internal.gate2_offer_push_outbox),
    2::bigint, 'old consent receipt stays distinct from the new grant');
create temporary table fresh_offer_push as
select id from internal.gate2_offer_push_outbox
where invite_id = 'a9870000-0000-4000-8000-000000000002'
order by queued_at desc limit 1;
grant select on fresh_offer_push to service_role;
set local role service_role;
select is(jsonb_array_length(public.list_gate2_offer_push_dispatchable()), 1,
    'only the new consent receipt is dispatchable');
select is(jsonb_array_length(public.prepare_gate2_offer_push_deliveries(
    (select id from fresh_offer_push))), 1,
    'new grant prepares one fresh delivery');
reset role;
update internal.gate2_offer_push_deliveries
set id = 'a9870000-0000-4000-8000-000000000022'
where id <> 'a9870000-0000-4000-8000-000000000021';
set local role service_role;
select is(public.claim_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000022',
    'a9870000-0000-4000-8000-000000000010') ->> 'endpoint',
    'https://push.example.invalid/matched',
    'current consent and offer expose one private endpoint claim');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatchable()), 0,
    'an uncertain claim is not sent a second time');
select ok(not public.observe_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000022',
    'a9870000-0000-4000-8000-000000000011', 'sent'),
    'another worker cannot settle the claim');
select ok(public.observe_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000022',
    'a9870000-0000-4000-8000-000000000010', 'sent'),
    'owning claim records one observed send');
select ok(public.observe_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000022',
    'a9870000-0000-4000-8000-000000000010', 'sent'),
    'exact observation replay is idempotent');
select ok(not public.observe_gate2_offer_push_delivery(
    'a9870000-0000-4000-8000-000000000022',
    'a9870000-0000-4000-8000-000000000010', 'failed'),
    'terminal sent observation cannot become failed');
reset role;
select is((select count(*) from internal.gate2_offer_push_deliveries
    where state = 'sent'), 1::bigint,
    'private ledger has one settled effect and one withheld old claim');
update public.invites set state = 'accepted'
where id = 'a9870000-0000-4000-8000-000000000002';
set local role service_role;
select is(jsonb_array_length(public.list_gate2_offer_push_candidates()), 0,
    'accepted offer is no longer a matched-offer push candidate');
select ok(not public.queue_gate2_offer_push(
    'a9870000-0000-4000-8000-000000000002'),
    'accepted offer cannot enqueue another notification');
select is(jsonb_array_length(public.list_gate2_offer_push_dispatchable()), 0,
    'old queued consent receipt cannot dispatch after offer acceptance');
reset role;
select * from finish();
rollback;
