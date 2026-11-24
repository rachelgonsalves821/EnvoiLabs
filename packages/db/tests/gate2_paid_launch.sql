begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

update public.studies set state = 'awaiting_payment'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.gate2_quote_snapshots (id, study_id, brief_version, guide_digest,
    pricing_config_id, pricing_config_version, line_items_json, total_cents,
    incentive_cents_per_complete, feasibility_json)
select 'a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1, repeat('a', 64), id, version,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}' from public.pricing_configs where active;
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_paid', 'paid', 500, 'usd', now());

select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), false,
    'a paid event without its checkout creation cannot launch');
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'wrong_event'), false,
    'caller event ID cannot substitute for a recorded provider observation');
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_created',
    'checkout_created', 500, 'usd', now());
set local role authenticated;
select throws_ok($$select public.launch_gate2_paid_study(
    '90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid')$$,
    '42501', null, 'researcher cannot call paid launch RPC');
reset role;
set local role service_role;
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), true,
    'service launch uses matching frozen quote and provider observation');
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), true,
    'exact launch retry returns prior outcome');
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'other_event'), false,
    'different event cannot replay fielding transition');
reset role;
select is((select state from public.studies
    where id = '90600000-0000-4000-8000-000000000001'), 'fielding',
    'study transitions once after paid observation');
select is((select count(*) from public.audit_log where entity = 'study'
    and entity_id = '90600000-0000-4000-8000-000000000001' and to_state = 'fielding'),
    1::bigint, 'one paid launch audit event is recorded');
select is((select meta ->> 'quoteId' from public.audit_log where entity = 'study'
    and entity_id = '90600000-0000-4000-8000-000000000001' and to_state = 'fielding'),
    'a9900000-0000-4000-8000-000000000001', 'audit records immutable quote identity');
select * from finish();
rollback;
