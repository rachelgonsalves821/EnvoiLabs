begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select ok(not has_function_privilege('anon', 'public.list_gate1_expired_audio(integer)', 'EXECUTE'),
    'anonymous callers cannot list private upload paths');
select ok(not has_function_privilege('authenticated', 'public.list_gate1_expired_audio(integer)', 'EXECUTE'),
    'signed-in callers cannot list private upload paths');
select ok(has_function_privilege('service_role', 'public.list_gate1_expired_audio(integer)', 'EXECUTE'),
    'the background service can list eligible upload paths');

insert into public.guide_questions (id, study_id, position, text)
values ('99500000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001', 1, 'Synthetic question');

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('99600000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160, clock_timestamp() + interval '1 hour'),
    ('99600000-0000-4000-8000-000000000002', '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002', 'accepted', 160, clock_timestamp() - interval '1 minute');

insert into public.sessions (id, invite_id, study_id, state)
values ('99700000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'in_progress'),
    ('99700000-0000-4000-8000-000000000002', '99600000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'abandoned');

insert into storage.buckets (id, name, public)
values ('gate1-test-unrelated-audio', 'gate1-test-unrelated-audio', false);

insert into internal.gate1_audio_uploads (id, session_id, question_id, bytes, mime, expires_at, confirmed_answer_id)
select format('99800000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    case when n in (1, 4) then '99700000-0000-4000-8000-000000000001'::uuid
        else '99700000-0000-4000-8000-000000000002'::uuid end,
    '99500000-0000-4000-8000-000000000001', 1024, 'audio/webm',
    clock_timestamp() + case when n in (1, 4) then interval '1 hour' else interval '-1 minute' end,
    case when n = 5 then '99900000-0000-4000-8000-000000000001'::uuid end
from generate_series(1, 7) as fixture(n);

-- Metadata is only used to test selection. The Storage API test covers deletion.
insert into storage.objects (bucket_id, name)
select case when right(id::text, 1) = '7' then 'gate1-test-unrelated-audio' else 'gate1-interview-audio' end,
    session_id::text || '/' || id::text
from internal.gate1_audio_uploads
where id <> '99800000-0000-4000-8000-000000000003';

insert into pii.audio_objects (id, storage_path, sha256, bytes, mime)
values ('99800000-0000-4000-8000-000000000006',
    '99700000-0000-4000-8000-000000000002/99800000-0000-4000-8000-000000000006',
    decode(repeat('aa', 32), 'hex'), 1024, 'audio/webm');

set local role service_role;
select results_eq($$ select storage_path from public.list_gate1_expired_audio(50) $$,
    $$ select '99700000-0000-4000-8000-000000000002/99800000-0000-4000-8000-000000000002'::text $$,
    'selects only the expired unconfirmed object in the exact private bucket, excluding live, missing and confirmed paths');
select is_empty($$ select * from public.list_gate1_expired_audio(null) $$, 'a missing batch bound selects nothing');
select is_empty($$ select * from public.list_gate1_expired_audio(0) $$, 'a zero batch bound selects nothing');
select is_empty($$ select * from public.list_gate1_expired_audio(-1) $$, 'a negative batch bound selects nothing');
reset role;

with bulk as (
    insert into internal.gate1_audio_uploads (id, session_id, question_id, bytes, mime, expires_at)
    select format('99900000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
        '99700000-0000-4000-8000-000000000002', '99500000-0000-4000-8000-000000000001',
        1024, 'audio/webm', clock_timestamp() - interval '45 seconds'
    from generate_series(1, 55) as fixture(n)
    returning id, session_id
)
insert into storage.objects (bucket_id, name)
select 'gate1-interview-audio', session_id::text || '/' || id::text from bulk;

set local role service_role;
select is((select count(*)::integer from public.list_gate1_expired_audio(1000)), 50,
    'the query caps the service batch even when the caller requests more');
select results_eq($$ select storage_path from public.list_gate1_expired_audio(1) $$,
    $$ select '99700000-0000-4000-8000-000000000002/99800000-0000-4000-8000-000000000002'::text $$,
    'the oldest eligible upload is first and listing does not consume it');
reset role;

select is((select count(*)::integer from internal.gate1_audio_uploads), 62,
    'listing leaves all upload reservations intact');
select * from finish();
rollback;
