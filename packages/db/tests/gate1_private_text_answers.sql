begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

update auth.users set email_confirmed_at = now()
where id in ('90300000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000002');
update public.studies set state = 'fielding' where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text)
select format('99500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    '90600000-0000-4000-8000-000000000001', n, 'Question ' || n
from generate_series(1, 4) as position(n);
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('99600000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160, now() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values ('99700000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'in_progress');

select ok(not has_table_privilege('authenticated', 'pii.transcript_raw', 'SELECT'), 'raw text stays private');
select ok(not has_table_privilege('authenticated', 'internal.gate1_answer_jobs', 'SELECT'), 'jobs remain private');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
    select public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'Synthetic answer')
$$, '42501', null, 'another verified respondent cannot save this session');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.start_gate1_session('99600000-0000-4000-8000-000000000001') $$,
    '23514', null, 'interview read withholds the question before consent');
select throws_ok($$
    select public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'Synthetic answer')
$$, '23514', null, 'record cannot write without retention consent');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'retention', true, 'gate1-preview-v1'),
    ('90500000-0000-4000-8000-000000000001', 'researcher_access', true, 'gate1-preview-v1');

set local role authenticated;
select is(public.start_gate1_session('99600000-0000-4000-8000-000000000001')
    #>> '{nextQuestion,text}', 'Question 1', 'current grants permit the next question');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'retention', false, 'gate1-preview-v1');
set local role authenticated;
select throws_ok($$ select public.start_gate1_session('99600000-0000-4000-8000-000000000001') $$,
    '23514', null, 'withdrawal withholds the resumed question');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'retention', true, 'gate1-preview-v1');
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', false, 'gate1-preview-v1');
set local role authenticated;
select throws_ok($$ select public.start_gate1_session('99600000-0000-4000-8000-000000000001') $$,
    '23514', null, 'researcher-access withdrawal also withholds the question');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', true, 'gate1-preview-v1');
set local role authenticated;
select throws_ok($$
    select public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000002', '99800000-0000-4000-8000-000000000002', 'Out of order')
$$, '23514', null, 'record cannot skip ahead');
select ok(position('Synthetic answer' in public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
    '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'Synthetic answer')::text) = 0,
    'answer acknowledgement exposes only metadata');
select is(public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
    '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'Synthetic answer') #>> '{answer,sequence}',
    '1', 'same id and identical text replay the existing answer');
select throws_ok($$
    select public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'Changed answer')
$$, '23505', null, 'same id cannot overwrite submitted text');
select throws_ok($$ select public.submit_gate1_session('99700000-0000-4000-8000-000000000001') $$,
    '23514', null, 'an incomplete four-question session cannot submit');
select is(public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
    '99500000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000005', 'Revised answer',
    '99800000-0000-4000-8000-000000000001') #>> '{answer,sequence}', '1', 'last answer can be replaced atomically');
select lives_ok($$
    select public.record_gate1_text_answer('99700000-0000-4000-8000-000000000001',
        format('99500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
        format('99800000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid, 'More synthetic text')
    from generate_series(2, 4) as steps(n) order by n
$$, 'the remaining answers are durable');
select is(public.submit_gate1_session('99700000-0000-4000-8000-000000000001') ->> 'state',
    'submitted', 'all four answers permit submission');
select is(public.submit_gate1_session('99700000-0000-4000-8000-000000000001') ->> 'state',
    'submitted', 'a submission replay returns the same receipt');
reset role;
select is((select count(*) from internal.gate1_answer_jobs as queued
    join public.answers as answer on answer.id = queued.answer_id
    join public.transcripts as transcript on transcript.answer_id = answer.id
    join pii.transcript_raw as raw on raw.transcript_id = transcript.id
    where answer.session_id = '99700000-0000-4000-8000-000000000001'
        and transcript.redacted_text is null and transcript.provider = 'typed'), 4::bigint,
    'four current answers each have private data and one durable job the researcher cannot see');
select is((select array_agg(to_state order by to_state) from public.audit_log
    where entity_id = '99700000-0000-4000-8000-000000000001'),
    array['quality_hold','submitted']::text[], 'both session transitions are recorded once');

select * from finish();
rollback;
