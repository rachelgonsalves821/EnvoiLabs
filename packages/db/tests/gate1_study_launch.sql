begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into public.studies (id, organization_id, title, target_completes, length_minutes, labels)
select format('99000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    '90100000-0000-4000-8000-000000000001', 'Gate 1 study fixture', 2, 10,
    case when n = 5 then '["gate1_food"]'::jsonb else '[]'::jsonb end
from generate_series(1, 8) as study(n);

insert into public.guide_questions (study_id, position, text)
select study.id, question.n, 'A test question'
from public.studies as study cross join generate_series(1, 4) as question(n)
where study.id in ('99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002');

insert into public.criteria (study_id, kind, attribute_key, operator, value_json, text)
values
    ('99000000-0000-4000-8000-000000000001', 'must', 'food_orders_per_week', 'gte', '1', 'Orders food'),
    ('99000000-0000-4000-8000-000000000001', 'nice', 'lives_on_campus', 'eq', 'true', 'Lives on campus'),
    ('99000000-0000-4000-8000-000000000002', 'must', 'missing_fact', 'eq', 'true', 'No one qualifies'),
    ('99000000-0000-4000-8000-000000000002', 'nice', 'student', 'eq', 'true', 'Is a student');

update public.respondents set status = 'paused' where id = '90500000-0000-4000-8000-000000000004';
update public.pricing_configs set params_json = '{"unitPriceCents":100,"incentivePerQuestionCents":55}'
where active;

insert into public.invites (study_id, respondent_id, state, reward_cents, expires_at)
values
    ('99000000-0000-4000-8000-000000000004', '90500000-0000-4000-8000-000000000002', 'invited', 0, now() + interval '1 hour'),
    ('99000000-0000-4000-8000-000000000005', '90500000-0000-4000-8000-000000000008', 'accepted', 0, now() - interval '10 days'),
    ('99000000-0000-4000-8000-000000000006', '90500000-0000-4000-8000-000000000010', 'accepted', 0, now() - interval '1 day'),
    ('99000000-0000-4000-8000-000000000007', '90500000-0000-4000-8000-000000000010', 'accepted', 0, now() - interval '1 day'),
    ('99000000-0000-4000-8000-000000000008', '90500000-0000-4000-8000-000000000010', 'accepted', 0, now() - interval '1 day');

insert into public.sessions (invite_id, study_id, state, started_at, submitted_at)
select id, study_id, 'submitted', expires_at - interval '3 hours', expires_at - interval '2 hours'
from public.invites where state = 'accepted';

select ok(not has_function_privilege('anon', 'public.launch_gate1_study(uuid,uuid,uuid)', 'EXECUTE'),
    'anonymous user cannot launch a study');
select ok(not has_function_privilege('authenticated', 'public.launch_gate1_study(uuid,uuid,uuid)', 'EXECUTE'),
    'clients cannot bypass the app preview setting');

set local role service_role;
select throws_ok($$
    select public.launch_gate1_study('90400000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000099', '99000000-0000-4000-8000-000000000001')
$$, '42501', null, 'another organization cannot launch the study');
select throws_ok($$
    select public.launch_gate1_study('90400000-0000-4000-8000-000000000001',
        '90100000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003')
$$, '23514', null, 'a study without its complete four-question guide cannot launch');
select throws_ok($$
    select public.launch_gate1_study('90400000-0000-4000-8000-000000000001',
        '90100000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002')
$$, 'P0002', null, 'a study without eligible respondents cannot launch');
select is((select state from public.studies where id = '99000000-0000-4000-8000-000000000002'),
    'draft', 'no eligible respondents leaves the study unchanged');
select is(public.launch_gate1_study('90400000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001') ->> 'state',
    'fielding', 'the draft launch records the fielding result');
select is((select state from public.studies where id = '99000000-0000-4000-8000-000000000001'),
    'fielding', 'the study is persisted as fielding');
select is((select array_agg(respondent_id order by respondent_id) from public.invites
    where study_id = '99000000-0000-4000-8000-000000000001'),
    array['90500000-0000-4000-8000-000000000014','90500000-0000-4000-8000-000000000016']::uuid[],
    'ranking applies nice-to-have criteria after filtering active offers, status, cooldown and participation cap');
select ok((select bool_and(state = 'invited' and reward_cents = 220
    and expires_at >= now() + interval '24 hours') from public.invites
    where study_id = '99000000-0000-4000-8000-000000000001'),
    'the invitations honor the configured four-question incentive and 24-hour expiry');
select is(public.launch_gate1_study('90400000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001') ->> 'state',
    'fielding', 'an identical retry returns the persisted result');
select is((select count(*) from public.invites where study_id = '99000000-0000-4000-8000-000000000001'),
    2::bigint, 'a retry cannot create duplicate invites');
select is((select count(*) from public.audit_log where entity = 'study'
    and entity_id = '99000000-0000-4000-8000-000000000001' and to_state = 'fielding'),
    1::bigint, 'the launch is audited once');
select is((select count(*) from public.audit_log where entity = 'invite' and to_state = 'invited'
    and entity_id in (select id from public.invites where study_id = '99000000-0000-4000-8000-000000000001')),
    2::bigint, 'each invite transition is audited once');

reset role;
select * from finish();
rollback;
