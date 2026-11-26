begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

-- Exercise the current ordered migration history: 138 replaces confirmation,
-- then 139 installs the expired-object selector. Storage rows here are metadata
-- stand-ins; the separate protected rehearsal must use signed Storage PUTs.
update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text) values (
    'a9f40000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1,
    'Describe a recent choice');
insert into public.consents (respondent_id, study_id, purpose, granted,
    text_version)
select '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', purpose, true, 'synthetic'
from (values ('retention'), ('recording'), ('transcription_vendor'))
    as grants(purpose);
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at) values (
    'a9f40000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 100,
    clock_timestamp() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state) values (
    'a9f40000-0000-4000-8000-000000000003',
    'a9f40000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into internal.gate1_audio_uploads (id, session_id, question_id,
    bytes, mime, expires_at) values (
    'a9f40000-0000-4000-8000-000000000004',
    'a9f40000-0000-4000-8000-000000000003',
    'a9f40000-0000-4000-8000-000000000001',
    1024, 'audio/webm', clock_timestamp() + interval '1 hour'),
    ('a9f40000-0000-4000-8000-000000000005',
    'a9f40000-0000-4000-8000-000000000003',
    'a9f40000-0000-4000-8000-000000000001',
    1024, 'audio/webm', clock_timestamp() - interval '1 minute');
insert into storage.objects (bucket_id, name) values (
    'gate1-interview-audio',
    'a9f40000-0000-4000-8000-000000000003/a9f40000-0000-4000-8000-000000000004');

select ok(pg_get_functiondef(
    'public.confirm_gate1_voice_answer(uuid,uuid,uuid,uuid,uuid,integer,bytea,uuid)'
        ::regprocedure) like '%position between 1 and 10%',
    'the marketplace confirmation replacement is the active function');
set local role service_role;
select is_empty($$select * from public.list_gate1_expired_audio(50)$$,
    'first sweep sees no object for the expired reservation');
select is(public.confirm_gate1_voice_answer(
    '90500000-0000-4000-8000-000000000001',
    'a9f40000-0000-4000-8000-000000000003',
    'a9f40000-0000-4000-8000-000000000001',
    'a9f40000-0000-4000-8000-000000000004',
    'a9f40000-0000-4000-8000-000000000006', 1000,
    decode(repeat('aa', 32), 'hex')) #>> '{answer,id}',
    'a9f40000-0000-4000-8000-000000000006',
    'the replaced function confirms the valid reservation before expiry');
reset role;
select is((select confirmed_answer_id::text from internal.gate1_audio_uploads
    where id = 'a9f40000-0000-4000-8000-000000000004'),
    'a9f40000-0000-4000-8000-000000000006',
    'confirmation binds the exact answer to the reservation');
update internal.gate1_audio_uploads set expires_at =
    clock_timestamp() - interval '1 minute'
where id = 'a9f40000-0000-4000-8000-000000000004';
set local role service_role;
select is_empty($$select * from public.list_gate1_expired_audio(50)$$,
    'an expired but confirmed object remains protected');
reset role;

-- A signed upload may arrive after the empty sweep; the next sweep must
-- discover it. A new confirmation after its reservation expiry must fail.
insert into storage.objects (bucket_id, name) values (
    'gate1-interview-audio',
    'a9f40000-0000-4000-8000-000000000003/a9f40000-0000-4000-8000-000000000005');
set local role service_role;
select results_eq($$select storage_path from public.list_gate1_expired_audio(50)$$,
    $$select 'a9f40000-0000-4000-8000-000000000003/a9f40000-0000-4000-8000-000000000005'::text$$,
    'a later sweep discovers the late expired unconfirmed object');
select throws_ok($$select public.confirm_gate1_voice_answer(
    '90500000-0000-4000-8000-000000000001',
    'a9f40000-0000-4000-8000-000000000003',
    'a9f40000-0000-4000-8000-000000000001',
    'a9f40000-0000-4000-8000-000000000005',
    'a9f40000-0000-4000-8000-000000000007', 1000,
    decode(repeat('bb', 32), 'hex'))$$,
    '23514', null, 'confirmation after reservation expiry is denied');
select results_eq($$select storage_path from public.list_gate1_expired_audio(50)$$,
    $$select 'a9f40000-0000-4000-8000-000000000003/a9f40000-0000-4000-8000-000000000005'::text$$,
    'failed confirmation leaves the object eligible on repeat sweep');
reset role;
select is((select count(*)::integer from public.answers
    where session_id = 'a9f40000-0000-4000-8000-000000000003'),
    1, 'only the pre-expiry confirmation wrote an answer');
select * from finish();
rollback;
