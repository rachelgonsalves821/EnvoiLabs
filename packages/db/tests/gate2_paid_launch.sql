begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

select is((select tgfoid from pg_trigger where tgname = 'lock_gate2_guide_study'
    and tgrelid = 'public.guide_questions'::regclass),
    (select tgfoid from pg_trigger where tgname = 'lock_gate2_brief_study'
    and tgrelid = 'public.brief_versions'::regclass),
    'guide and brief writes use the same study lock trigger');
select ok(pg_get_functiondef('internal.lock_gate2_study_content()'::regprocedure)
    like '%from public.studies where id = target_id for update%',
    'content edits acquire the study row lock before mutation');

update public.studies set state = 'awaiting_payment', target_completes = 1
where id = '90600000-0000-4000-8000-000000000001';
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select '90600000-0000-4000-8000-000000000001', position,
    'Synthetic question ' || position from generate_series(1, 5) as position;
insert into public.gate2_quote_snapshots (id, study_id, brief_version, guide_digest,
    pricing_config_id, pricing_config_version, line_items_json, total_cents,
    incentive_cents_per_complete, feasibility_json)
select 'a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1,
    public.gate2_guide_digest('90600000-0000-4000-8000-000000000001'), id, version,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}' from public.pricing_configs where active;
select ok(not has_table_privilege('service_role', 'public.gate2_quote_snapshots', 'INSERT'),
    'service must freeze through the canonical guide digest function');
select ok(not has_function_privilege('service_role',
    'internal.freeze_gate2_quote_unchecked(uuid,integer,uuid,integer,jsonb,integer,integer,jsonb)',
    'EXECUTE'), 'service cannot bypass authoritative quote economics');
set local role service_role;
select is(public.freeze_gate2_quote('90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}'),
    'a9900000-0000-4000-8000-000000000001'::uuid,
    'same frozen quote request returns the immutable quote ID');
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    600, 200, '{"expectedCompletes":1,"hours":24}')$$,
    '23514', null, 'quote replay cannot change the frozen price');
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":4,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}')$$,
    '23514', null, 'screener or omitted core question cannot change the billed count');
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":99,"amountCents":495}]',
    495, 200, '{"expectedCompletes":1,"hours":24}')$$,
    '23514', null, 'caller cannot substitute an unapproved unit price');
reset role;
select throws_ok($$update public.pricing_configs set params_json =
    '{"unitPriceCents":99,"incentivePerQuestionCents":40}' where active$$,
    '23514', null, 'a used pricing config version cannot be rewritten');
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
select ok(not has_function_privilege('authenticated', 'public.gate2_guide_digest(uuid)', 'EXECUTE'),
    'only the service can calculate the canonical frozen guide digest');
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_created',
    'checkout_created', 500, 'usd', now());
select throws_ok($$insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
    values ('a9900000-0000-4000-8000-000000000001',
        '90600000-0000-4000-8000-000000000001', 'cs_duplicate', 'evt_created_again',
        'checkout_created', 500, 'usd', now())$$,
    '23505', null, 'a frozen quote cannot acquire a second checkout identity');
set local role service_role;
select is(public.freeze_gate2_quote('90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}'),
    'a9900000-0000-4000-8000-000000000001'::uuid,
    'checkout retry keeps the one frozen quote');
reset role;
set local role authenticated;
select throws_ok($$select public.launch_gate2_paid_study(
    '90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid')$$,
    '42501', null, 'researcher cannot call paid launch RPC');
reset role;
update public.guide_questions set text = 'Changed after quote'
where study_id = '90600000-0000-4000-8000-000000000001' and position = 1;
set local role service_role;
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}')$$,
    '23514', null, 'changed guide cannot open a second checkout quote');
reset role;
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), false,
    'a changed question invalidates the frozen guide digest');
update public.guide_questions set text = 'Synthetic question 1'
where study_id = '90600000-0000-4000-8000-000000000001' and position = 1;
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 2, '{"revision":2}',
    '90400000-0000-4000-8000-000000000001');
set local role service_role;
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 2,
    (select id from public.pricing_configs where active),
    (select version from public.pricing_configs where active),
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}')$$,
    '23514', null, 'newer brief cannot open second checkout while first is outstanding');
reset role;
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), false,
    'a newer brief invalidates the frozen quote');
delete from public.brief_versions where study_id = '90600000-0000-4000-8000-000000000001'
    and version = 2;
savepoint observed_failure;
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_failed',
    'failed', 500, 'usd', now());
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), false,
    'recorded provider failure prevents launch');
rollback to savepoint observed_failure;
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
update public.studies set state = 'awaiting_payment'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_refund',
    'refunded', 500, 'usd', now());
select is(public.launch_gate2_paid_study('90600000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001', 'evt_paid'), false,
    'recorded refund prevents a second paid transition');
select * from finish();
rollback;
