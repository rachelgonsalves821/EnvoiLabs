begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
    ('91900000-0000-4000-8000-000000000001', 'home-a@example.test', now()),
    ('91900000-0000-4000-8000-000000000002', 'home-b@example.test', now()),
    ('91900000-0000-4000-8000-000000000003', 'home-paused@example.test', now());
insert into public.respondents (id, auth_user_id, status, age_attested_at) values
    ('91900000-0000-4000-9000-000000000001', '91900000-0000-4000-8000-000000000001', 'active', now()),
    ('91900000-0000-4000-9000-000000000002', '91900000-0000-4000-8000-000000000002', 'active', now()),
    ('91900000-0000-4000-9000-000000000003', '91900000-0000-4000-8000-000000000003', 'paused', now());
insert into public.organizations (id, name)
values ('91900000-0000-4000-a000-000000000001', 'Private organization');

insert into public.studies (id, organization_id, title, state, target_completes, length_minutes)
select format('91900000-0000-4000-b000-%s', lpad(n::text, 12, '0'))::uuid,
    '91900000-0000-4000-a000-000000000001', 'Private project ' || n,
    case when n = 8 then 'draft' else 'fielding' end, 1, 8
from generate_series(1, 9) n;
insert into public.guide_questions (study_id, position, text)
select studies.id, position, 'Restricted test prompt ' || position
from public.studies cross join generate_series(1, 4) position
where studies.organization_id = '91900000-0000-4000-a000-000000000001';
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at, why_you_text)
select format('91900000-0000-4000-c000-%s', lpad(n::text, 12, '0'))::uuid,
    format('91900000-0000-4000-b000-%s', lpad(n::text, 12, '0'))::uuid,
    format('91900000-0000-4000-9000-%s', lpad(owner_number::text, 12, '0'))::uuid,
    state, 250, now() + hours_left * interval '1 hour', case when n = 1 then 'Matched on delivery habits' end
from (values
    (1, 1, 'invited', 1), (2, 1, 'screening', 3), (3, 1, 'accepted', 2),
    (4, 1, 'invited', -1), (5, 1, 'declined', 4), (6, 2, 'invited', 1),
    (7, 1, 'accepted', 5), (8, 1, 'invited', 1), (9, 3, 'invited', 1)
) as rows(n, owner_number, state, hours_left);
insert into public.sessions (invite_id, study_id, state)
select id, study_id, case when id = '91900000-0000-4000-c000-000000000003' then 'in_progress' else 'submitted' end
from public.invites where id in ('91900000-0000-4000-c000-000000000003', '91900000-0000-4000-c000-000000000007');

select ok(not has_function_privilege('anon', 'public.list_gate1_home_invites()', 'EXECUTE'),
    'anonymous actors cannot run the Home projection');

set local role authenticated;
set local request.jwt.claims = '{"sub":"91900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is(jsonb_array_length(public.list_gate1_home_invites()), 3, 'only current offers, screening and active work remain');
select is(public.list_gate1_home_invites() #>> '{0,id}', '91900000-0000-4000-c000-000000000001',
    'earliest expiry comes first');
select is(public.list_gate1_home_invites() #>> '{1,id}', '91900000-0000-4000-c000-000000000003',
    'active session precedes the later screening');
select is(public.list_gate1_home_invites() #>> '{1,resumable}', 'true', 'active interview can be marked in progress');
select is(public.list_gate1_home_invites() #>> '{0,coreQuestionCount}', '4', 'count supplied without exposing guide text');
select is(public.list_gate1_home_invites() #>> '{0,lengthMinutes}', '8', 'study duration is safely projected');
select ok(
    not (public.list_gate1_home_invites() -> 0 ?| array['title','organization_id','studyId','text','sessionId'])
    and public.list_gate1_home_invites()::text not like '%Private project%',
    'the projection excludes tenant identifiers, internal titles, guide text and session IDs'
);

set local request.jwt.claims = '{"sub":"91900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select is(jsonb_array_length(public.list_gate1_home_invites()), 1, 'a different respondent only sees their offer');
set local request.jwt.claims = '{"sub":"91900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';
select is(jsonb_array_length(public.list_gate1_home_invites()), 0, 'paused respondents see no offers');

reset role;
select * from finish();
rollback;
