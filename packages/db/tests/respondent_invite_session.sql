begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

update auth.users set email_confirmed_at = now()
where id in ('90300000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000002');
update public.studies set state = 'fielding' where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (study_id, position, text)
select '90600000-0000-4000-8000-000000000001', n, 'Question ' || n
from generate_series(1, 4) as position(n);

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values
    ('99100000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
     '90500000-0000-4000-8000-000000000001', 'invited', 160, now() + interval '3 hours'),
    ('99100000-0000-4000-8000-000000000002', '90600000-0000-4000-8000-000000000001',
     '90500000-0000-4000-8000-000000000002', 'invited', 160, now() - interval '1 minute');

select ok(not has_function_privilege('anon', 'public.start_gate1_session(uuid)', 'EXECUTE'),
    'unsigned users cannot start an interview');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.update_gate1_invite('99100000-0000-4000-8000-000000000001', 'accept') $$,
    '42501', null, 'another respondent cannot accept this offer');
select throws_ok($$ select public.update_gate1_invite('99100000-0000-4000-8000-000000000002', 'accept') $$,
    '23514', null, 'an expired offer cannot create a session');

set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.start_gate1_session('99100000-0000-4000-8000-000000000001') $$,
    '23514', null, 'guide cannot open before acceptance');
select is(public.update_gate1_invite('99100000-0000-4000-8000-000000000001', 'accept') ->> 'state',
    'accepted', 'the respondent can accept an eligible offer');
select is(public.update_gate1_invite('99100000-0000-4000-8000-000000000001', 'accept') ->> 'state',
    'accepted', 'a retry returns the existing acceptance');
select is(public.start_gate1_session('99100000-0000-4000-8000-000000000001') #>> '{nextQuestion,text}',
    'Question 1', 'starting returns only the first unanswered question');
select matches(public.start_gate1_session('99100000-0000-4000-8000-000000000001') ->> 'expiresAt',
    'Z$', 'the response uses a UTC ISO deadline');
select throws_ok($$ select public.update_gate1_invite('99100000-0000-4000-8000-000000000001', 'decline') $$,
    '23514', null, 'a completed acceptance cannot be rewritten as a decline');

reset role;
insert into public.answers (session_id, study_id, guide_question_id, kind, sequence)
select interview.id, interview.study_id, question.id, 'text', question.position
from public.sessions as interview join public.guide_questions as question using (study_id)
where interview.invite_id = '99100000-0000-4000-8000-000000000001' and question.position <= 2;

set local role authenticated;
select is(public.start_gate1_session('99100000-0000-4000-8000-000000000001') #>> '{nextQuestion,text}',
    'Question 3', 'returning reads progress from committed answers');
reset role;
select is((select count(*) from public.sessions where invite_id = '99100000-0000-4000-8000-000000000001'),
    1::bigint, 'the invite has one persistent session');
select is((select count(*) from public.audit_log where entity = 'invite' and to_state = 'accepted'
    and entity_id = '99100000-0000-4000-8000-000000000001'), 1::bigint, 'acceptance is audited once');
select is((select count(*) from public.audit_log where entity = 'session' and to_state = 'in_progress'
    and entity_id in (select id from public.sessions where invite_id = '99100000-0000-4000-8000-000000000001')),
    1::bigint, 'session start is audited once');

select * from finish();
rollback;
