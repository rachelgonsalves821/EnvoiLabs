begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.studies (id, organization_id, title, state, target_completes, length_minutes)
select 'a9b10000-0000-4000-8000-000000000010', organization_id,
    'Other synthetic study', 'fielding', 4, 10
from public.studies where id = '90600000-0000-4000-8000-000000000001';
insert into public.criteria (id, study_id, kind, attribute_key, operator, value_json, text)
values ('a9b10000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past 12 months');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9b10000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 200, now() + interval '1 day'),
    ('a9b10000-0000-4000-8000-000000000012',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002', 'screening', 200, now() + interval '1 day'),
    ('a9b10000-0000-4000-8000-000000000013',
    'a9b10000-0000-4000-8000-000000000010',
    '90500000-0000-4000-8000-000000000002', 'invited', 200, now() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'retention-v1'),
    ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'retention-v1');

select throws_ok($$insert into public.gate2_screening_rules
    (id, study_id, criterion_id, version, criterion_kind, criterion_text,
    timeframe_text, question, approved_by, approved_at)
    values ('a9b10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a nurse', 'past 12 months', 'Did you work as a nurse?',
    '90400000-0000-4000-8000-000000000001', now())$$,
    '23514', null, 'rule cannot silently change approved criterion wording');
insert into public.gate2_screening_rules
    (id, study_id, criterion_id, version, criterion_kind, criterion_text,
    timeframe_text, question, approved_by, approved_at)
values ('a9b10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked as a hospital nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
select is((public.get_gate2_screening_rule(
    'a9b10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 1) ->> 'criterionText'),
    'Worked as a hospital nurse in the past 12 months',
    'exact approved wording is retrievable for the validator');
select ok(not has_function_privilege('authenticated',
    'public.store_gate2_screening_answer(uuid,uuid,uuid,uuid,integer,text,text,text,text)', 'EXECUTE'),
    'respondent cannot forge private answer RPC');
select ok(not has_table_privilege('service_role', 'pii.gate2_screener_answers', 'INSERT'),
    'service must use checked private answer RPC');

create temp table stored_answer (payload jsonb);
grant select, insert on stored_answer to service_role;
set local role service_role;
insert into stored_answer select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:first');
select is(public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:first') ->> 'id',
    (select payload ->> 'id' from stored_answer), 'exact answer retry returns one private row');
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'Different answer', null, 'screening:first')$$,
    '23505', null, 'same key cannot change answer text');
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:first')$$,
    '23505', null, 'another respondent cannot replay a private answer');
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000010',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:cross-study')$$,
    '42501', null, 'another study cannot use this invite and rule');
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'voice',
    'I worked there.', 'voice-v1', 'screening:voice-denied')$$,
    '23514', null, 'voice transcription needs current recording and vendor consent');
select ok(public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from stored_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true) ->> 'action' = 'qualify',
    'supported decision is committed with invite transition');
select is((select state from public.invites where id =
    'a9b10000-0000-4000-8000-000000000002'), 'invited',
    'qualified screening changes invite state atomically');
select is(public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from stored_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true) ->> 'answerId',
    (select payload ->> 'id' from stored_answer),
    'exact decision retry returns prior committed event');
reset role;

insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'recording', true, 'voice-v1'),
    ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'voice-v1');
insert into pii.gate2_screening_transcription_receipts (id, invite_id, study_id,
    respondent_id, rule_id, rule_version, audio_object_id, audio_storage_path,
    audio_bytes, audio_mime, duration_ms, audio_sha256,
    provider, model, transcript_text, recording_consent_id,
    transcription_consent_id, transcription_consent_version)
select 'a9b10000-0000-4000-8000-000000000020',
    'a9b10000-0000-4000-8000-000000000012',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002',
    'a9b10000-0000-4000-8000-000000000003', 1,
    'a9b10000-0000-4000-8000-000000000021',
    'screening/a9b10000-0000-4000-8000-000000000012/a9b10000-0000-4000-8000-000000000021',
    4096, 'audio/webm', 5000, repeat('a', 64),
    'synthetic', 'fixture', 'I worked as a hospital nurse this year.',
    (select id from public.consents where respondent_id =
        '90500000-0000-4000-8000-000000000002' and purpose = 'recording'
        order by recorded_sequence desc limit 1),
    (select id from public.consents where respondent_id =
        '90500000-0000-4000-8000-000000000002' and purpose = 'transcription_vendor'
        order by recorded_sequence desc limit 1), 'voice-v1';
select ok(not has_table_privilege('service_role',
    'pii.gate2_screening_transcription_receipts', 'INSERT'),
    'service callers cannot fabricate private transcription receipts');
select ok(not has_function_privilege('authenticated',
    'public.store_gate2_screening_transcribed_answer(uuid,text)', 'EXECUTE'),
    'browser clients cannot store an unreviewed transcribed answer');
create temp table capped_answer (payload jsonb);
grant select, insert on capped_answer to service_role;
set local role service_role;
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000012',
    '90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'voice',
    'I worked as a hospital nurse this year.', 'voice-v1', 'screening:voice-bypass')$$,
    '23514', null, 'caller text cannot masquerade as transcribed voice');
insert into capped_answer select public.store_gate2_screening_transcribed_answer(
    'a9b10000-0000-4000-8000-000000000020', 'screening:voice');
select ok((select payload ->> 'id' from capped_answer) is not null,
    'consented transcript receipt is stored privately');
select is(public.store_gate2_screening_transcribed_answer(
    'a9b10000-0000-4000-8000-000000000020', 'screening:voice') ->> 'id',
    (select payload ->> 'id' from capped_answer),
    'transcribed answer retry returns the same private row');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', false, 'withdrawn-v2');
set local role service_role;
select throws_ok($$select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000012',
    '90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'voice',
    'I worked as a hospital nurse this year.', 'voice-v1', 'screening:voice')$$,
    '23514', null, 'withdrawn consent blocks private answer replay');
select throws_ok($$select public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from capped_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true)$$,
    '23514', null, 'withdrawn voice consent blocks qualification');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'voice-v3');
set local role service_role;
select throws_ok($$select public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from capped_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true)$$,
    '23514', null, 'new consent text does not retroactively authorize old voice answer');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'voice-v1');
set local role service_role;
select throws_ok($$select public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from capped_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true)$$,
    '23514', null, 'regranting identical words cannot reactivate old voice source');
select throws_ok($$select public.store_gate2_screening_transcribed_answer(
    'a9b10000-0000-4000-8000-000000000020',
    'screening:stale-voice-source')$$,
    '23514', null, 'old transcription receipt cannot be reused after regrant');
reset role;
insert into pii.gate2_screening_transcription_receipts (id, invite_id, study_id,
    respondent_id, rule_id, rule_version, audio_object_id, audio_storage_path,
    audio_bytes, audio_mime, duration_ms, audio_sha256,
    provider, model, transcript_text, recording_consent_id,
    transcription_consent_id, transcription_consent_version)
select 'a9b10000-0000-4000-8000-000000000024',
    'a9b10000-0000-4000-8000-000000000012',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002',
    'a9b10000-0000-4000-8000-000000000003', 1,
    'a9b10000-0000-4000-8000-000000000025',
    'screening/a9b10000-0000-4000-8000-000000000012/a9b10000-0000-4000-8000-000000000025',
    4096, 'audio/webm', 5000, repeat('b', 64),
    'synthetic', 'fixture', 'I worked as a hospital nurse this year.',
    (select id from public.consents where respondent_id =
        '90500000-0000-4000-8000-000000000002' and purpose = 'recording'
        order by recorded_sequence desc limit 1),
    (select id from public.consents where respondent_id =
        '90500000-0000-4000-8000-000000000002' and purpose = 'transcription_vendor'
        order by recorded_sequence desc limit 1), 'voice-v1';
delete from capped_answer;
set local role service_role;
insert into capped_answer select public.store_gate2_screening_transcribed_answer(
    'a9b10000-0000-4000-8000-000000000024', 'screening:voice-regrant');
select throws_ok($$select public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from capped_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true)$$,
    '23514', null, 'active other invite blocks qualification at transition');
select is((select count(*) from public.gate2_screening_events where answer_id =
    (select (payload ->> 'id')::uuid from capped_answer)), 0::bigint,
    'cap rejection leaves no partial decision event');
reset role;
update public.invites set state = 'declined'
where id = 'a9b10000-0000-4000-8000-000000000013';
set local role service_role;
select ok(public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from capped_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true) ->> 'action' = 'qualify',
    'retry succeeds after capacity clears');
reset role;
select is((select state from public.invites where id =
    'a9b10000-0000-4000-8000-000000000012'), 'invited',
    'capacity recheck then atomically invites respondent');

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9b10000-0000-4000-8000-000000000022',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000003', 'screening', 200, now() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'retention-v1');
create temp table stale_answer (payload jsonb);
grant select, insert on stale_answer to service_role;
set local role service_role;
insert into stale_answer select public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000022',
    '90500000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000003', 1, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:stale');
reset role;

insert into public.gate2_screening_rules
    (id, study_id, criterion_id, version, criterion_kind, criterion_text,
    timeframe_text, question, approved_by, approved_at)
values ('a9b10000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000001', 2, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked in a hospital as a nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
select is(public.get_gate2_screening_rule(
    'a9b10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 1), null::jsonb,
    'superseded approved rule is unavailable to new screening');
set local role service_role;
select throws_ok($$select public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from stale_answer),
    'a9b10000-0000-4000-8000-000000000003', 1,
    'supported', 2, 37, 'qualify', true)$$,
    '23514', null, 'superseded rule cannot qualify a pending answer');
reset role;
select is((select state from public.invites where id =
    'a9b10000-0000-4000-8000-000000000022'), 'screening',
    'stale-rule rejection leaves invite in screening');

insert into public.criteria (id, study_id, kind, attribute_key, operator, value_json, text)
values ('a9b10000-0000-4000-8000-000000000031',
    '90600000-0000-4000-8000-000000000001', 'nice', 'toronto', 'eq', 'true',
    'Lived in Toronto in the past 12 months');
insert into public.gate2_screening_rules
    (id, study_id, criterion_id, version, criterion_kind, criterion_text,
    timeframe_text, question, approved_by, approved_at)
values ('a9b10000-0000-4000-8000-000000000032',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000031', 1, 'nice',
    'Lived in Toronto in the past 12 months', 'past 12 months',
    'Have you lived in Toronto in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9b10000-0000-4000-8000-000000000033',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000004', 'screening', 200, now() + interval '1 day');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'retention-v1');
create temp table multi_answer (rule_number integer, payload jsonb);
grant select, insert on multi_answer to service_role;
set local role service_role;
insert into multi_answer select 1, public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000033',
    '90500000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000004', 2, 'text',
    'I worked as a hospital nurse this year.', null, 'screening:multi:1');
select ok(public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from multi_answer where rule_number = 1),
    'a9b10000-0000-4000-8000-000000000004', 2,
    'supported', 2, 37, 'qualify', true) ->> 'action' = 'qualify',
    'first approved question records a qualifying decision');
select is((select state from public.invites where id =
    'a9b10000-0000-4000-8000-000000000033'), 'screening',
    'first of two questions does not prematurely invite');
insert into multi_answer select 2, public.store_gate2_screening_answer(
    'a9b10000-0000-4000-8000-000000000033',
    '90500000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9b10000-0000-4000-8000-000000000032', 1, 'text',
    'I have lived in Toronto this year.', null, 'screening:multi:2');
select ok(public.commit_gate2_screening_decision(
    (select (payload ->> 'id')::uuid from multi_answer where rule_number = 2),
    'a9b10000-0000-4000-8000-000000000032', 1,
    'supported', 2, 32, 'qualify', true) ->> 'action' = 'qualify',
    'second approved question records a qualifying decision');
select is((select state from public.invites where id =
    'a9b10000-0000-4000-8000-000000000033'), 'invited',
    'all approved questions are required before inviting');
reset role;

set local role authenticated;
select ok(not has_function_privilege('authenticated',
    'public.commit_gate2_screening_decision(uuid,uuid,integer,text,integer,integer,text,boolean)',
    'EXECUTE'), 'respondent cannot forge qualification decision');
select throws_ok($$select answer_text from pii.gate2_screener_answers$$,
    '42501', null, 'private screening answer is not researcher-readable');
select * from finish();
rollback;
