begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.criteria (id, study_id, kind, attribute_key, operator,
    value_json, text) values ('a9f90000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past 12 months');
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at) values ('a9f90000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 500,
    clock_timestamp() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version) values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'synthetic');
insert into public.gate2_screening_rules (id, study_id, criterion_id, version,
    criterion_kind, criterion_text, timeframe_text, question,
    approved_by, approved_at) values (
    'a9f90000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9f90000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked as a hospital nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
insert into pii.gate2_screener_answers (id, invite_id, study_id, rule_id,
    rule_version, kind, answer_text, idempotency_key) values (
    'a9f90000-0000-4000-8000-000000000004',
    'a9f90000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9f90000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse. Email fictional@example.test.',
    'synthetic:redaction-publisher');
insert into internal.gate1_redaction_policies
    (policy_digest, qualification_digest) values (repeat('a', 64), repeat('b', 64));

select ok(not has_function_privilege('authenticated',
    'public.read_gate2_screening_redaction_input(uuid,text)', 'EXECUTE'),
    'browser cannot read raw screening input');
select ok(not has_function_privilege('authenticated',
    'public.publish_gate2_screening_redacted_source(uuid,text,text,text,boolean,text)',
    'EXECUTE'), 'browser cannot publish screening output');
select ok(not has_table_privilege('service_role',
    'internal.gate2_screening_redacted_sources', 'INSERT'),
    'service role cannot directly insert qualified output');
set local role service_role;
select is(public.read_gate2_screening_redaction_input(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64))
    ->> 'answerText',
    'I worked as a hospital nurse. Email fictional@example.test.',
    'restricted publisher reads the exact private source');
select is(public.read_gate2_screening_redaction_input(
    'a9f90000-0000-4000-8000-000000000004', repeat('c', 64)), null,
    'unapproved policy cannot read the source');
select ok((public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    encode(pg_catalog.sha256(convert_to(
        'I worked as a hospital nurse. Email fictional@example.test.', 'UTF8')),
        'hex'), 'I worked as a hospital nurse. Email [redacted].', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000005')
    ->> 'qualified')::boolean, 'qualified local result is published');
select ok((public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    encode(pg_catalog.sha256(convert_to(
        'I worked as a hospital nurse. Email fictional@example.test.', 'UTF8')),
        'hex'), 'I worked as a hospital nurse. Email [redacted].', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000005')
    ->> 'sourceVersion') is not null,
    'identical key replays the same immutable source version');
select throws_ok($$select public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    encode(pg_catalog.sha256(convert_to(
        'I worked as a hospital nurse. Email fictional@example.test.', 'UTF8')),
        'hex'), 'Changed text', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000005')$$,
    '23505', null, 'same key cannot publish changed text');
select throws_ok($$select public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    repeat('c', 64), 'Changed text', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000006')$$,
    '23514', null, 'changed raw source digest cannot be published');
select is((public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    encode(pg_catalog.sha256(convert_to(
        'I worked as a hospital nurse. Email fictional@example.test.', 'UTF8')),
        'hex'), null, false,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000007')
    ->> 'qualified'), 'false',
    'failed redaction publishes a withholding row instead of old text');
reset role;
select is((select count(*)::integer from internal.gate2_screening_redacted_sources
    where answer_id = 'a9f90000-0000-4000-8000-000000000004'
        and qualified), 1,
    'idempotent replay did not create a second qualified source');
select is((select qualified from internal.gate2_screening_redacted_sources
    where answer_id = 'a9f90000-0000-4000-8000-000000000004'
    order by sequence desc limit 1), false,
    'latest source is withheld after a failed re-redaction');
create temporary table screening_original_source as
    select source_version from internal.gate2_screening_redacted_sources
    where answer_id = 'a9f90000-0000-4000-8000-000000000004'
        and qualified order by sequence limit 1;
set local role service_role;
select ok((public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    encode(pg_catalog.sha256(convert_to(
        'I worked as a hospital nurse. Email fictional@example.test.', 'UTF8')),
        'hex'), 'I worked as a hospital nurse. Email [redacted].', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000009')
    ->> 'qualified')::boolean,
    'same text may be requalified under a new publication identity');
reset role;
select isnt((select source_version from internal.gate2_screening_redacted_sources
    where answer_id = 'a9f90000-0000-4000-8000-000000000004'
    order by sequence desc limit 1),
    (select source_version from screening_original_source),
    'identical-text re-publication rotates the immutable source version');
update internal.gate1_redaction_policies set revoked_at = now()
    where policy_digest = repeat('a', 64);
set local role service_role;
select is(public.read_gate2_screening_redaction_input(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64)), null,
    'revoked redaction policy cannot read input for a new publication');
reset role;
update internal.gate1_redaction_policies set revoked_at = null
    where policy_digest = repeat('a', 64);
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version) values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', false, 'synthetic');
set local role service_role;
select is(public.read_gate2_screening_redaction_input(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64)), null,
    'withdrawal blocks a fresh raw source read');
select throws_ok($$select public.publish_gate2_screening_redacted_source(
    'a9f90000-0000-4000-8000-000000000004', repeat('a', 64),
    repeat('c', 64), 'safe', true,
    'gate2-redaction:a9f90000-0000-4000-8000-000000000008')$$,
    '23514', null, 'withdrawal blocks publication');
reset role;
select * from finish();
rollback;
