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
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_screening_sheet(
    'a9d10000-0000-4000-8000-000000000003') -> 'questions' -> 0 ->> 'status',
    'pending_transcription', 'owner sees current audio as pending on reload');
reset role;
set local role service_role;
create temp table claimed_screening_audio (payload jsonb);
grant select, insert on claimed_screening_audio to service_role;
insert into claimed_screening_audio select public.claim_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture));
select ok((select (payload ->> 'leaseId')::uuid is not null
    from claimed_screening_audio), 'one worker receives a private lease');
select ok(public.validate_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    (select (payload ->> 'leaseId')::uuid from claimed_screening_audio)),
    'worker rechecks the current recording source before transcription');
select is(public.claim_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture)),
    null::jsonb, 'competing worker cannot claim an active lease');
select is(public.complete_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    (select (payload ->> 'leaseId')::uuid from claimed_screening_audio),
    'I worked as a hospital nurse this year.', 'synthetic', 'fixture') ->> 'status',
    'completed', 'leased completion writes the exact private receipt and answer');
select is((select count(*)::integer from pii.gate2_screening_transcription_receipts
    where audio_object_id = (select (payload ->> 'audioObjectId')::uuid
        from screening_audio_fixture)), 1,
    'one immutable transcription receipt is bound to the confirmed audio');
select is((select count(*)::integer from pii.gate2_screener_answers as answer
    join pii.gate2_screening_transcription_receipts as receipt
        on receipt.id = answer.transcription_receipt_id
    where receipt.audio_object_id = (select (payload ->> 'audioObjectId')::uuid
        from screening_audio_fixture)
        and answer.kind = 'voice' and answer.answer_text = receipt.transcript_text),
    1, 'private voice answer copies only the worker receipt transcript');
select is(public.complete_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    (select (payload ->> 'leaseId')::uuid from claimed_screening_audio),
    'I worked as a hospital nurse this year.', 'synthetic', 'fixture') ->> 'status',
    'alreadyCompleted', 'same completed lease replays without a second answer');
select is(public.claim_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture)),
    null::jsonb, 'completed audio cannot be leased again');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_screening_sheet(
    'a9d10000-0000-4000-8000-000000000003') -> 'questions' -> 0 ->> 'status',
    'pending_review', 'stored voice answer is pending review on reload');
reset role;
create temp table duplicate_screening_audio (payload jsonb);
grant select, insert on duplicate_screening_audio to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into duplicate_screening_audio select public.reserve_gate2_screening_audio(
    'a9d10000-0000-4000-8000-000000000003',
    'a9d10000-0000-4000-8000-000000000002', 1, 4096, 'audio/webm');
reset role;
set local role service_role;
select is(public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from duplicate_screening_audio),
    5000, repeat('b',64)) ->> 'status', 'queued',
    'a second tab can confirm another object while an answer is pending');
select is(public.claim_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from duplicate_screening_audio)),
    null::jsonb, 'worker does not transcribe a second pending answer for the same rule');
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
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_screening_sheet(
    'a9d10000-0000-4000-8000-000000000003') -> 'questions' -> 0 ->> 'status',
    'unanswered', 'withdrawal hides the old voice source from the sheet');
reset role;
set local role service_role;
select throws_ok($$select public.confirm_gate2_screening_audio(
    '90500000-0000-4000-8000-000000000001',
    'a9d10000-0000-4000-8000-000000000003',
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    5000, repeat('a',64))$$, '23514', null,
    'withdrawal blocks even an otherwise identical confirmation replay');
select is(public.complete_gate2_screening_audio(
    (select (payload ->> 'audioObjectId')::uuid from screening_audio_fixture),
    (select (payload ->> 'leaseId')::uuid from claimed_screening_audio),
    'I worked as a hospital nurse this year.', 'synthetic', 'fixture') ->> 'status',
    'stale', 'withdrawal blocks completion replay from exposing old receipt');
select * from finish();
rollback;
