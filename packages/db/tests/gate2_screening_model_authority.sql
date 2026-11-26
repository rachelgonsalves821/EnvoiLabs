begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.criteria (id, study_id, kind, attribute_key, operator,
    value_json, text) values ('a9f20000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past 12 months');
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at) values ('a9f20000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 500,
    clock_timestamp() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'synthetic');
insert into public.gate2_screening_rules (id, study_id, criterion_id, version,
    criterion_kind, criterion_text, timeframe_text, question,
    approved_by, approved_at) values (
    'a9f20000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked as a hospital nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
insert into pii.gate2_screener_answers (id, invite_id, study_id, rule_id,
    rule_version, kind, answer_text, idempotency_key) values (
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', 'synthetic:ai-screening');

select ok(not has_function_privilege('authenticated',
    'public.current_gate2_screening_model_source(uuid,uuid,uuid,integer,text,text,text)',
    'EXECUTE'), 'browser clients cannot read the private screening source');
select ok(not has_table_privilege('service_role',
    'internal.gate2_screening_model_policies', 'INSERT'),
    'service cannot silently approve a screening model policy');
select throws_ok($$insert into public.consents
    (respondent_id, purpose, granted, text_version)
    values ('90500000-0000-4000-8000-000000000001',
    'ai_screening', true, 'synthetic')$$, '23514', null,
    'screening model consent cannot be granted for every study');

set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'no approved policy or purpose grant means no model source');
reset role;
insert into internal.gate2_screening_model_policies (provider_model,
    prompt_version, prompt_digest, consent_text_version,
    consent_text_digest, approved_at) values (
    'synthetic-model', 'screening-v1', repeat('a', 64),
    'synthetic-ai-screening-v1', repeat('b', 64), now());
set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'policy without study-specific grant remains denied');
reset role;
insert into public.consents (id, respondent_id, study_id, purpose,
    granted, text_version) values ('a9f20000-0000-4000-8000-000000000005',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', true,
    'synthetic-ai-screening-v1');
set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'a grant without the exact disclosure digest receipt remains denied');
reset role;
insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
values ('a9f20000-0000-4000-8000-000000000005', repeat('b', 64));
set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)) ->> 'answerText',
    'I worked as a hospital nurse this year.',
    'current explicit grant exposes only the exact private source to service');
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'other-model', 'screening-v1', repeat('a', 64)), null,
    'wrong provider model is denied');
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('c', 64)), null,
    'wrong prompt digest is denied');
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000002',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'another study cannot reuse the private answer');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version) values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', false,
    'synthetic-ai-screening-v1');
set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'later purpose withdrawal blocks a replay before model use');
reset role;
insert into public.consents (id, respondent_id, study_id, purpose,
    granted, text_version) values ('a9f20000-0000-4000-8000-000000000006',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', true,
    'synthetic-ai-screening-v1');
insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
values ('a9f20000-0000-4000-8000-000000000006', repeat('b', 64));
insert into public.gate2_screening_rules (id, study_id, criterion_id, version,
    criterion_kind, criterion_text, timeframe_text, question,
    approved_by, approved_at) values (
    'a9f20000-0000-4000-8000-000000000007',
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000001', 2, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked in a hospital as a nurse during the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
set local role service_role;
select is(public.current_gate2_screening_model_source(
    '90600000-0000-4000-8000-000000000001',
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1,
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'a newer approved rule invalidates the earlier answer source');
reset role;
select * from finish();
rollback;
