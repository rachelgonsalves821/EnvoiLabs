begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update auth.users set email_confirmed_at = now()
where id = '90300000-0000-4000-8000-000000000001';
update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.criteria (id, study_id, kind, attribute_key, operator,
    value_json, text)
values ('a9c10000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past 12 months');
insert into public.gate2_screening_rules (id, study_id, criterion_id,
    version, criterion_kind, criterion_text, timeframe_text,
    question, approved_by, approved_at)
values ('a9c10000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9c10000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past 12 months', 'past 12 months',
    'Have you worked as a hospital nurse in the past 12 months?',
    '90400000-0000-4000-8000-000000000001', now());
insert into public.invites (id, study_id, respondent_id, state, reward_cents,
    expires_at)
values ('a9c10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 200,
    now() + interval '1 day');
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'retention', true, 'synthetic-retention');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.read_gate2_screening_sheet(
    'a9c10000-0000-4000-8000-000000000003'), null::jsonb,
    'another respondent cannot read approved screener questions');
select throws_ok($$select public.submit_gate2_screening_text(
    'a9c10000-0000-4000-8000-000000000003',
    'a9c10000-0000-4000-8000-000000000002', 1,
    'I worked there last year.',
    'gate2-screen:11111111-1111-4111-8111-111111111111')$$,
    '42501', 'insufficient_privilege',
    'another respondent cannot submit an answer');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(jsonb_array_length(public.read_gate2_screening_sheet(
    'a9c10000-0000-4000-8000-000000000003') -> 'questions'), 1,
    'owner reads one approved screening question');
select is(public.read_gate2_screening_sheet(
    'a9c10000-0000-4000-8000-000000000003') -> 'questions' -> 0 ->> 'status',
    'unanswered', 'initial question is unanswered');
select is(public.submit_gate2_screening_text(
    'a9c10000-0000-4000-8000-000000000003',
    'a9c10000-0000-4000-8000-000000000002', 1,
    'I worked there last year.',
    'gate2-screen:11111111-1111-4111-8111-111111111111') ->> 'status',
    'pending_review', 'typed answer is stored without an AI decision');
select is(public.submit_gate2_screening_text(
    'a9c10000-0000-4000-8000-000000000003',
    'a9c10000-0000-4000-8000-000000000002', 1,
    'I worked there last year.',
    'gate2-screen:11111111-1111-4111-8111-111111111111') ->> 'status',
    'pending_review', 'exact retry returns the same pending state');
select throws_ok($$select public.submit_gate2_screening_text(
    'a9c10000-0000-4000-8000-000000000003',
    'a9c10000-0000-4000-8000-000000000002', 1,
    'Another answer',
    'gate2-screen:22222222-2222-4222-8222-222222222222')$$,
    '23514', 'check_violation',
    'a second answer cannot replace a pending one');
select is(public.read_gate2_screening_sheet(
    'a9c10000-0000-4000-8000-000000000003') -> 'questions' -> 0 ->> 'status',
    'pending_review', 'owner sees a review state without private answer text');
reset role;
select is((select count(*)::integer from pii.gate2_screener_answers
    where invite_id = 'a9c10000-0000-4000-8000-000000000003'), 1,
    'one private typed answer exists after replay');
select is((select count(*)::integer from public.gate2_screening_events
    where answer_id in (select id from pii.gate2_screener_answers
        where invite_id = 'a9c10000-0000-4000-8000-000000000003')), 0,
    'no model or eligibility decision was manufactured');
select is((select state from public.invites
    where id = 'a9c10000-0000-4000-8000-000000000003'), 'screening',
    'offer remains in screening until a qualified decision');
select * from finish();
rollback;
