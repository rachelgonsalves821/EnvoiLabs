begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

update public.studies set state = 'fielding', labels = '["gate1_food"]'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.studies (id, organization_id, title, target_completes, length_minutes, state)
values ('90600000-0000-4000-8000-000000000002', '90100000-0000-4000-8000-000000000001',
  'Unrelated study', 2, 10, 'fielding');

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
select format('90110000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    case when n = 5 then '90600000-0000-4000-8000-000000000002'::uuid
        else '90600000-0000-4000-8000-000000000001'::uuid end,
    format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    case when n <= 3 then 'accepted' else 'invited' end, 160, now() + interval '24 hours'
from generate_series(1, 5) as fixture(n);

insert into public.sessions (invite_id, study_id, state, submitted_at)
select id, study_id,
    case when id = '90110000-0000-4000-8000-000000000001' then 'started'
        when id = '90110000-0000-4000-8000-000000000002' then 'in_progress'
        else 'submitted' end,
    case when id = '90110000-0000-4000-8000-000000000003' then now() end
from public.invites where state = 'accepted';

select ok(not has_function_privilege('authenticated', 'public.expire_gate1_interviews(timestamptz)', 'EXECUTE'),
    'signed-in clients cannot run expiry jobs');
set local role service_role;
select is(public.expire_gate1_interviews(now() + interval '23 hours'),
    '{"expiredInvites":0,"abandonedSessions":0}'::jsonb, 'a clock before the cutoff preserves current interviews');
select is(public.expire_gate1_interviews(now() + interval '24 hours'),
    '{"expiredInvites":1,"abandonedSessions":2}'::jsonb, 'at 24 hours it closes the open offer and active interviews');
select is(public.expire_gate1_interviews(now() + interval '25 hours'),
    '{"expiredInvites":0,"abandonedSessions":0}'::jsonb, 'a repeated job does not record a second transition');
select is((select state from public.sessions where invite_id = '90110000-0000-4000-8000-000000000003'),
    'submitted', 'a completed interview is preserved');
select is((select state from public.invites where id = '90110000-0000-4000-8000-000000000005'),
    'invited', 'an unrelated study stays outside the dedicated job scope');
select is((select count(*) from public.audit_log where to_state in ('expired', 'abandoned')
    and at = now() + interval '24 hours'), 3::bigint, 'successful transitions each have one audit at the supplied time');
reset role;

select * from finish();
rollback;
