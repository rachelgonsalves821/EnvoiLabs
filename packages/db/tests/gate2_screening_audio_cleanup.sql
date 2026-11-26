begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.list_gate2_expired_screening_audio(integer)', 'EXECUTE'),
    'anonymous clients cannot list private screening audio');
select ok(not has_function_privilege('authenticated',
    'public.list_gate2_expired_screening_audio(integer)', 'EXECUTE'),
    'signed-in clients cannot list private screening audio');
select ok(has_function_privilege('service_role',
    'public.list_gate2_expired_screening_audio(integer)', 'EXECUTE'),
    'only the trusted cleanup service can list expired paths');

insert into public.criteria (id, study_id, kind, attribute_key, operator,
    value_json, text)
values ('a9e10000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse');
insert into public.gate2_screening_rules (id, study_id, criterion_id,
    version, criterion_kind, criterion_text, timeframe_text,
    question, approved_by, approved_at)
values ('a9e10000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9e10000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse', 'past year', 'Have you worked as a nurse?',
    '90400000-0000-4000-8000-000000000001', now());
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9e10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 200,
    now() + interval '1 day');
insert into storage.buckets (id, name, public)
values ('gate2-screening-other-test', 'gate2-screening-other-test', false);
insert into internal.gate2_screening_audio_uploads
    (id, invite_id, study_id, respondent_id, rule_id, rule_version,
    bytes, mime, expires_at, duration_ms, sha256, confirmed_at)
select format('a9e10000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    'a9e10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001',
    'a9e10000-0000-4000-8000-000000000002', 1, 1024, 'audio/webm',
    now() + case when n = 1 then interval '1 hour' else interval '-1 minute' end,
    case when n = 4 then 5000 end, case when n = 4 then repeat('a', 64) end,
    case when n = 4 then now() - interval '2 minutes' end
from generate_series(1, 5) as fixture(n);
insert into storage.objects (bucket_id, name)
select case when right(id::text, 1) = '5' then 'gate2-screening-other-test'
    else 'gate2-screening-audio' end,
    'screening/' || invite_id || '/' || id
from internal.gate2_screening_audio_uploads
where id <> 'a9e10000-0000-4000-8000-000000000003';

set local role service_role;
select results_eq($$select storage_path from public.list_gate2_expired_screening_audio(50)$$,
    $$select 'screening/a9e10000-0000-4000-8000-000000000003/a9e10000-0000-4000-8000-000000000002'::text$$,
    'only the expired unconfirmed object in the exact private bucket is selected');
select is_empty($$select * from public.list_gate2_expired_screening_audio(null)$$,
    'missing batch bound selects nothing');
select is_empty($$select * from public.list_gate2_expired_screening_audio(0)$$,
    'zero batch bound selects nothing');
reset role;
delete from storage.objects where name =
    'screening/a9e10000-0000-4000-8000-000000000003/a9e10000-0000-4000-8000-000000000002';
set local role service_role;
select is_empty($$select * from public.list_gate2_expired_screening_audio(50)$$,
    'deleted object does not reappear on retry');
select * from finish();
rollback;
