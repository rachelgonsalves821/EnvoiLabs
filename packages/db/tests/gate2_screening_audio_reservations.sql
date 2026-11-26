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
values ('a9d10000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'nurse', 'eq', 'true',
    'Worked as a hospital nurse in the past year');
insert into public.gate2_screening_rules (id, study_id, criterion_id,
    version, criterion_kind, criterion_text, timeframe_text,
    question, approved_by, approved_at)
values ('a9d10000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000001', 1, 'must',
    'Worked as a hospital nurse in the past year', 'past year',
    'Have you worked as a hospital nurse in the past year?',
    '90400000-0000-4000-8000-000000000001', now());
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9d10000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 200,
    now() + interval '1 day');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.reserve_gate2_screening_audio(
    'a9d10000-0000-4000-8000-000000000003',
    'a9d10000-0000-4000-8000-000000000002', 1, 4096, 'audio/webm')$$,
    '42501', null, 'recording requires current consent');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'retention', true, 'fixture'),
    ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'recording', true, 'fixture'),
    ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'fixture');
create temp table screening_audio_fixture (payload jsonb);
grant select, insert on screening_audio_fixture to authenticated, service_role;
set local role authenticated;
insert into screening_audio_fixture select public.reserve_gate2_screening_audio(
    'a9d10000-0000-4000-8000-000000000003',
    'a9d10000-0000-4000-8000-000000000002', 1, 4096, 'audio/webm');
select ok((select (payload ->> 'audioObjectId')::uuid is not null
    from screening_audio_fixture), 'owner gets a private audio reservation');
select is(public.read_gate2_screening_audio_reservation(
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture)) ->> 'mime',
    'audio/webm', 'owner can confirm the exact reservation');
select throws_ok($$select public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('a',64))$$, '42501', null,
    'respondent cannot directly confirm unverified bytes');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.read_gate2_screening_audio_reservation(
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture))$$,
    '42501', null, 'another respondent cannot read the reservation');
reset role;
set local role service_role;
select is(public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('a',64)) ->> 'status', 'queued',
    'server verification can queue a consented recording');
select is(public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('a',64)) ->> 'status', 'queued',
    'identical confirmation replays without new work');
select throws_ok($$select public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('b',64))$$, '23505', null,
    'changed bytes cannot replay the reservation');
reset role;
update internal.gate2_screening_audio_uploads
set expires_at = now() - interval '1 second'
where id = (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture);
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_screening_audio_reservation(
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture)) ->> 'confirmed',
    'true', 'confirmed recording remains readable for retry after lease expiry');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'transcription_vendor', false, 'fixture');
set local role service_role;
select throws_ok($$select public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('a',64))$$, '23514', null,
    'withdrawal blocks even an otherwise identical confirmation replay');
select * from finish();
rollback;
