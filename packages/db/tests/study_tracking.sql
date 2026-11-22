begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into auth.users (id) values ('91900000-0000-4000-8000-000000000001');
insert into public.organizations (id, name) values ('91900000-0000-4000-8000-000000000002', 'Other organization');
insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
values ('91900000-0000-4000-8000-000000000001', '91900000-0000-4000-8000-000000000002', 'fixture-1', now());
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
select format('91900000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    '90600000-0000-4000-8000-000000000001',
    format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    state, 200, now() + interval '1 day'
from unnest(array['accepted', 'accepted', 'invited', 'declined', 'expired', 'matched', 'screening'])
with ordinality as states(state, n);
insert into public.sessions (study_id, invite_id, state, submitted_at)
values ('90600000-0000-4000-8000-000000000001', '91900000-0000-4000-8000-000000000011', 'quality_hold', now()),
       ('90600000-0000-4000-8000-000000000001', '91900000-0000-4000-8000-000000000012', 'removed', now());

select ok(not has_function_privilege('anon', 'public.get_gate1_study_tracking(uuid)', 'execute'),
    'anonymous clients have no tracking access');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.get_gate1_study_tracking('90600000-0000-4000-8000-000000000001'),
    '{"studyId":"90600000-0000-4000-8000-000000000001","title":"Late-night food choices fixture","targetCompletes":20,"state":"draft","projectedFinish":null,"invited":5,"accepted":2,"completed":1,"removed":1}'::jsonb,
    'tenant researcher sees aggregate counts without identities or a fabricated finish estimate');
select is((select count(id) from public.invites), 0::bigint, 'tracking does not grant raw invitation rows');
select is(public.get_gate1_study_tracking('91900000-0000-4000-8000-000000000003'), null::jsonb,
    'unknown study returns no row');

set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is(public.get_gate1_study_tracking('90600000-0000-4000-8000-000000000001'), null::jsonb,
    'researcher requires MFA to see tracking');
set local request.jwt.claims = '{"sub":"91900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.get_gate1_study_tracking('90600000-0000-4000-8000-000000000001'), null::jsonb,
    'other organizations cannot see tracking');
select is(internal.gate1_study_counts('90600000-0000-4000-8000-000000000001'), null::jsonb,
    'internal count helper independently checks organization');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.get_gate1_study_tracking('90600000-0000-4000-8000-000000000001'), null::jsonb,
    'invited respondents cannot use researcher tracking');

select * from finish();
rollback;
