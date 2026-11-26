begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.criteria (id, study_id, kind, attribute_key, operator,
    value_json, text) values ('a9f30000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past 12 months');
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at) values ('a9f30000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 500,
    clock_timestamp() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version) values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'synthetic');
insert into public.gate2_screening_rules (id, study_id, criterion_id, version,
    criterion_kind, criterion_text, timeframe_text, question,
    approved_by, approved_at) values (
    'a9f30000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9f30000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked as a hospital nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
insert into pii.gate2_screener_answers (id, invite_id, study_id, rule_id,
    rule_version, kind, answer_text, idempotency_key) values (
    'a9f30000-0000-4000-8000-000000000004',
    'a9f30000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9f30000-0000-4000-8000-000000000003', 1, 'text',
    'I am a nurse. a@b.co', 'synthetic:qualified-decision');
insert into internal.gate1_redaction_policies (policy_digest,
    qualification_digest) values (repeat('c', 64), repeat('d', 64));
insert into internal.gate2_screening_model_policies (provider_model,
    prompt_version, prompt_digest, consent_text_version,
    consent_text_digest, approved_at) values (
    'synthetic-model', 'screening-v1', repeat('a', 64),
    'synthetic-ai-screening-v1', repeat('b', 64), now());
insert into public.consents (id, respondent_id, study_id, purpose,
    granted, text_version) values ('a9f30000-0000-4000-8000-000000000005',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', true,
    'synthetic-ai-screening-v1');
insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
values ('a9f30000-0000-4000-8000-000000000005', repeat('b', 64));
insert into internal.gate2_screening_redacted_sources (answer_id,
    raw_answer_digest, redacted_text, redaction_policy_digest,
    qualification_digest, qualified) values (
    'a9f30000-0000-4000-8000-000000000004',
    encode(pg_catalog.sha256(convert_to('I am a nurse. a@b.co', 'UTF8')), 'hex'),
    'I am a nurse. [email address removed]',
    repeat('c', 64), repeat('d', 64), true);

select ok(not has_function_privilege('authenticated',
    'public.commit_gate2_qualified_screening_decision(uuid,uuid,integer,text,integer,integer,text,boolean,uuid,text,text,text,text)',
    'EXECUTE'), 'browser cannot submit a model-backed decision');
set local role service_role;
select is(public.commit_gate2_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'a9f30000-0000-4000-8000-000000000003', 1,
    'supported', 0, 36, 'qualify', true,
    (public.current_gate2_screening_model_source(
        '90600000-0000-4000-8000-000000000001',
        'a9f30000-0000-4000-8000-000000000004',
        'a9f30000-0000-4000-8000-000000000003', 1,
        'synthetic-model', 'screening-v1', repeat('a', 64))
        ->> 'redactedSourceVersion')::uuid,
    repeat('c', 64), 'synthetic-model', 'screening-v1', repeat('a', 64))
    ->> 'action', 'qualify',
    'qualified citation may use the longer redacted source and invite atomically');
select is(public.commit_gate2_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'a9f30000-0000-4000-8000-000000000003', 1,
    'supported', 0, 36, 'qualify', true,
    (public.current_gate2_screening_model_source(
        '90600000-0000-4000-8000-000000000001',
        'a9f30000-0000-4000-8000-000000000004',
        'a9f30000-0000-4000-8000-000000000003', 1,
        'synthetic-model', 'screening-v1', repeat('a', 64))
        ->> 'redactedSourceVersion')::uuid,
    repeat('c', 64), 'synthetic-model', 'screening-v1', repeat('a', 64))
    ->> 'action', 'qualify', 'exact decision replay returns the same result');
reset role;
select is((select state from public.invites
    where id = 'a9f30000-0000-4000-8000-000000000002'),
    'invited', 'one qualified decision advances the offer');
select is((select count(*)::integer from public.gate2_screening_events
    where answer_id = 'a9f30000-0000-4000-8000-000000000004'), 1,
    'replay does not duplicate the private event');
select is((select end_char from public.gate2_screening_events
    where answer_id = 'a9f30000-0000-4000-8000-000000000004'), 36,
    'evidence offset is stored against the redacted source');
set local role service_role;
select is(public.get_gate2_current_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'synthetic-model', 'screening-v1', repeat('a', 64)) ->> 'action',
    'qualify', 'retry reader sees only the current qualified decision');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version) values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', false,
    'synthetic-ai-screening-v1');
set local role service_role;
select throws_ok($$select public.commit_gate2_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'a9f30000-0000-4000-8000-000000000003', 1,
    'supported', 0, 36, 'qualify', true,
    (select redacted_source_version from public.gate2_screening_events
        where answer_id = 'a9f30000-0000-4000-8000-000000000004'),
    repeat('c', 64), 'synthetic-model', 'screening-v1', repeat('a', 64))$$,
    '23514', null, 'withdrawn screening purpose invalidates decision replay');
reset role;
insert into public.consents (id, respondent_id, study_id, purpose,
    granted, text_version) values ('a9f30000-0000-4000-8000-000000000006',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', true,
    'synthetic-ai-screening-v1');
insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
values ('a9f30000-0000-4000-8000-000000000006', repeat('b', 64));
delete from public.consents
where id = 'a9f30000-0000-4000-8000-000000000006';
set local role service_role;
select is(public.get_gate2_current_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'deleted purpose grant cannot keep the old model decision current');
reset role;
insert into public.consents (id, respondent_id, study_id, purpose,
    granted, text_version) values ('a9f30000-0000-4000-8000-000000000007',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_screening', true,
    'synthetic-ai-screening-v1');
insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
values ('a9f30000-0000-4000-8000-000000000007', repeat('b', 64));
insert into internal.gate2_screening_redacted_sources (answer_id,
    raw_answer_digest, redacted_text, redaction_policy_digest,
    qualification_digest, qualified) values (
    'a9f30000-0000-4000-8000-000000000004',
    encode(pg_catalog.sha256(convert_to('I am a nurse. a@b.co', 'UTF8')), 'hex'),
    null, repeat('c', 64), repeat('d', 64), false);
set local role service_role;
select throws_ok($$select public.commit_gate2_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'a9f30000-0000-4000-8000-000000000003', 1,
    'supported', 0, 36, 'qualify', true,
    (select redacted_source_version from public.gate2_screening_events
        where answer_id = 'a9f30000-0000-4000-8000-000000000004'),
    repeat('c', 64), 'synthetic-model', 'screening-v1', repeat('a', 64))$$,
    '23514', null, 'withheld re-redaction invalidates a prior decision replay');
select is(public.get_gate2_current_qualified_screening_decision(
    'a9f30000-0000-4000-8000-000000000004',
    'synthetic-model', 'screening-v1', repeat('a', 64)), null,
    'retry reader does not fall back after a withheld source');
reset role;
select * from finish();
rollback;
