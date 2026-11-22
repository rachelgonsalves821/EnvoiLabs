begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

update auth.users set email_confirmed_at = now()
where id in ('90300000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000002');
update public.studies set state = 'fielding' where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text)
values ('99500000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001', 1, 'First question');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('99600000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160, now() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values ('99700000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'retention', true, 'gate1-preview-v1');

select is((select public from storage.buckets where id = 'gate1-interview-audio'), false, 'media bucket is private');
select ok(not has_function_privilege('authenticated',
    'public.confirm_gate1_voice_answer(uuid,uuid,uuid,uuid,uuid,integer,bytea,uuid)', 'EXECUTE'),
    'browser cannot bypass server verification of uploaded bytes');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$
    select public.reserve_gate1_audio('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000001', 100, 'audio/webm')
$$, '23514', null, 'voice reservation is denied without both voice decisions');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'recording', true, 'gate1-preview-v1'),
    ('90500000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'gate1-preview-v1');
set local role authenticated;
select ok(set_config('envoi.test_audio_id', public.reserve_gate1_audio('99700000-0000-4000-8000-000000000001',
    '99500000-0000-4000-8000-000000000001', 100, 'audio/webm') ->> 'audioObjectId', true) <> '',
    'verified owner can reserve supported private audio after consent');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
    select public.read_gate1_audio_reservation('99700000-0000-4000-8000-000000000001',
        '99500000-0000-4000-8000-000000000001', current_setting('envoi.test_audio_id')::uuid)
$$, '42501', null, 'another respondent cannot resolve the reservation');
reset role;
set local role service_role;
select is(public.confirm_gate1_voice_answer('90500000-0000-4000-8000-000000000001',
    '99700000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000001',
    current_setting('envoi.test_audio_id')::uuid, '99800000-0000-4000-8000-000000000001', 1234,
    decode(repeat('ab', 32), 'hex')) #>> '{answer,kind}', 'voice', 'server can persist a verified recording');
select is(public.confirm_gate1_voice_answer('90500000-0000-4000-8000-000000000001',
    '99700000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000001',
    current_setting('envoi.test_audio_id')::uuid, '99800000-0000-4000-8000-000000000001', 1234,
    decode(repeat('ab', 32), 'hex')) #>> '{answer,id}', '99800000-0000-4000-8000-000000000001',
    'confirmation retries return the same answer');
select throws_ok($$
    select public.confirm_gate1_voice_answer('90500000-0000-4000-8000-000000000001',
        '99700000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000001',
        current_setting('envoi.test_audio_id')::uuid, '99800000-0000-4000-8000-000000000002', 1234,
        decode(repeat('ab', 32), 'hex'))
$$, '23505', null, 'one upload cannot attach to a different answer');
reset role;
select is((select count(*) from internal.gate1_answer_jobs where answer_id = '99800000-0000-4000-8000-000000000001'),
    1::bigint, 'the recording queues one durable job without raw text or media');
select is((select count(*) from public.transcripts where answer_id = '99800000-0000-4000-8000-000000000001'),
    0::bigint, 'voice remains unpublished before ASR and redaction');

select * from finish();
rollback;
