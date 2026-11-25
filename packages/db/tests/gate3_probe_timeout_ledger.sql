begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text, max_probes)
values ('a9720000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1, 'Why did you choose it?', 2),
    ('a9720000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 2, 'What happened next?', 2),
    ('a9720000-0000-4000-8000-00000000000b',
    '90600000-0000-4000-8000-000000000001', 3, 'What made it helpful?', 2);
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9720000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 200,
    clock_timestamp() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values ('a9720000-0000-4000-8000-000000000004',
    'a9720000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', purpose, true, 'synthetic-only'
from unnest(array['retention', 'researcher_access', 'ai_followup']) as consent(purpose);

insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at, updated_at)
values ('a9720000-0000-4000-8000-000000000005',
    'a9720000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9720000-0000-4000-8000-000000000001', 'text', 1,
    clock_timestamp() - interval '12 seconds',
    clock_timestamp() - interval '12 seconds');
insert into public.transcripts (id, answer_id, study_id, redacted_text,
    provider, model, latency_ms, cost_micros)
values ('a9720000-0000-4000-8000-000000000006',
    'a9720000-0000-4000-8000-000000000005',
    '90600000-0000-4000-8000-000000000001',
    'The shorter route helped.', 'typed', 'none', 0, 0);
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9720000-0000-4000-8000-000000000005',
    decode(repeat('c', 64), 'hex'), clock_timestamp(), 'published',
    repeat('a', 64), repeat('b', 64));

select ok(not has_function_privilege('authenticated',
    'public.record_gate3_probe_timeout(uuid,uuid)', 'EXECUTE'),
    'only the trusted worker can record a timeout');
set local role service_role;
select is(public.begin_gate3_probe_turn(
    'a9720000-0000-4000-8000-000000000005',
    '90300000-0000-4000-8000-000000000001', 1000), null::uuid,
    'late qualified transcript cannot open a model-ready turn');
select is(public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000005',
    '90300000-0000-4000-8000-000000000002') ->> 'status', 'stale',
    'another respondent cannot record the timeout');
create temporary table missed_transcript (result jsonb not null);
grant select, insert on missed_transcript to service_role;
insert into missed_transcript select public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000005',
    '90300000-0000-4000-8000-000000000001');
select is((select result -> 'value' -> 'decision' ->> 'outcome'
    from missed_transcript), 'timeout',
    'late transcript gets a durable timeout decision');
select is(public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000005',
    '90300000-0000-4000-8000-000000000001') -> 'value' ->> 'turnId',
    (select result -> 'value' ->> 'turnId' from missed_transcript),
    'timeout replay returns the same turn');
select is((select public.commit_gate3_probe_decision(
    'a9720000-0000-4000-8000-000000000004',
    'a9720000-0000-4000-8000-000000000001',
    'a9720000-0000-4000-8000-000000000005',
    (result -> 'value' ->> 'turnId')::uuid,
    '90300000-0000-4000-8000-000000000001',
    (result -> 'value' ->> 'sourceVersion')::uuid,
    result -> 'value' ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe',
        'turnId', result -> 'value' ->> 'turnId',
        'uploadConfirmedAtMs', 1000, 'text', 'Why?'))
        -> 'value' -> 'decision' ->> 'outcome' from missed_transcript),
    'timeout', 'a late model result cannot replace the timeout');
reset role;
select ok((select browser_upload_confirmed_ms is null
    from internal.gate3_probe_turns
    where answer_id = 'a9720000-0000-4000-8000-000000000005'),
    'missing browser clock stays null rather than fabricating zero latency');
select is((select count(*) from public.probes where answer_id =
    'a9720000-0000-4000-8000-000000000005'), 0::bigint,
    'late transcription creates no probe');

insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at, updated_at)
values ('a9720000-0000-4000-8000-000000000007',
    'a9720000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9720000-0000-4000-8000-000000000002', 'text', 2,
    clock_timestamp() - interval '12 seconds',
    clock_timestamp() - interval '12 seconds');
insert into public.transcripts (id, answer_id, study_id, redacted_text,
    provider, model, latency_ms, cost_micros)
values ('a9720000-0000-4000-8000-000000000008',
    'a9720000-0000-4000-8000-000000000007',
    '90600000-0000-4000-8000-000000000001',
    'The price mattered.', 'typed', 'none', 0, 0);
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9720000-0000-4000-8000-000000000007',
    decode(repeat('d', 64), 'hex'), clock_timestamp() - interval '10 seconds',
    'published', repeat('a', 64), repeat('b', 64));
set local role service_role;
create temporary table provider_turn (turn_id uuid not null);
grant select, insert on provider_turn to service_role;
insert into provider_turn select public.begin_gate3_probe_turn(
    'a9720000-0000-4000-8000-000000000007',
    '90300000-0000-4000-8000-000000000001', 2000);
select ok((select turn_id is not null from provider_turn),
    'qualified source opened a turn before the decision deadline');
select is((select public.read_gate3_ready_probe_turn(
    'a9720000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001') from provider_turn),
    null::jsonb, 'expired turn cannot start another model call');
create temporary table missed_provider (result jsonb not null);
grant select, insert on missed_provider to service_role;
insert into missed_provider select public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000007',
    '90300000-0000-4000-8000-000000000001');
select is((select result -> 'value' -> 'decision' ->> 'outcome'
    from missed_provider), 'timeout',
    'provider deadline miss is stored separately from no-probe and error');
select is((select public.commit_gate3_probe_decision(
    'a9720000-0000-4000-8000-000000000004',
    'a9720000-0000-4000-8000-000000000002',
    'a9720000-0000-4000-8000-000000000007',
    (result -> 'value' ->> 'turnId')::uuid,
    '90300000-0000-4000-8000-000000000001',
    (result -> 'value' ->> 'sourceVersion')::uuid,
    result -> 'value' ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe',
        'turnId', result -> 'value' ->> 'turnId',
        'uploadConfirmedAtMs', 2000, 'text', 'What else?'))
        -> 'value' -> 'decision' ->> 'outcome' from missed_provider),
    'timeout', 'provider result arriving after timeout loses first-writer race');
reset role;
select is((select count(*) from public.probes where answer_id =
    'a9720000-0000-4000-8000-000000000007'), 0::bigint,
    'provider timeout creates no probe');

-- A committed probe wins even when a later timeout caller observes an expired
-- deadline. Keep the pre-deadline and existing-decision branches explicit.
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at, updated_at)
values ('a9720000-0000-4000-8000-000000000009',
    'a9720000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'a9720000-0000-4000-8000-00000000000b', 'text', 3,
    clock_timestamp() - interval '1 second', clock_timestamp());
insert into public.transcripts (id, answer_id, study_id, redacted_text,
    provider, model, latency_ms, cost_micros)
values ('a9720000-0000-4000-8000-00000000000a',
    'a9720000-0000-4000-8000-000000000009',
    '90600000-0000-4000-8000-000000000001',
    'The clear steps helped.', 'typed', 'none', 0, 0);
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9720000-0000-4000-8000-000000000009',
    decode(repeat('e', 64), 'hex'), clock_timestamp(), 'published',
    repeat('a', 64), repeat('b', 64));
set local role service_role;
select is(public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000009',
    '90300000-0000-4000-8000-000000000001') ->> 'status', 'not_due',
    'a qualified answer before its deadline is not timed out');
create temporary table first_writer_turn (turn_id uuid not null);
grant select, insert on first_writer_turn to service_role;
insert into first_writer_turn select public.begin_gate3_probe_turn(
    'a9720000-0000-4000-8000-000000000009',
    '90300000-0000-4000-8000-000000000001', 3000);
select ok((select turn_id is not null from first_writer_turn),
    'current qualified answer opens a timely turn');
select is(public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000009',
    '90300000-0000-4000-8000-000000000001') ->> 'status', 'not_due',
    'an opened turn before its deadline is not timed out');
create temporary table first_writer_probe (result jsonb not null);
grant select, insert on first_writer_probe to service_role;
insert into first_writer_probe select public.commit_gate3_probe_decision(
    'a9720000-0000-4000-8000-000000000004',
    'a9720000-0000-4000-8000-00000000000b',
    'a9720000-0000-4000-8000-000000000009', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (public.read_gate3_ready_probe_turn(
        'a9720000-0000-4000-8000-000000000004', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'sourceVersion')::uuid,
    public.read_gate3_ready_probe_turn(
        'a9720000-0000-4000-8000-000000000004', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe', 'turnId', turn_id,
        'uploadConfirmedAtMs', 3000, 'text', 'What made those steps clear?'))
from first_writer_turn;
select is((select result ->> 'status' from first_writer_probe), 'committed',
    'probe is the first committed decision');
reset role;
alter table internal.gate3_probe_turns disable trigger gate3_keep_probe_turn_identity;
update internal.gate3_probe_turns set
    decision_deadline_at = clock_timestamp() - interval '1 second'
where id = (select turn_id from first_writer_turn);
alter table internal.gate3_probe_turns enable trigger gate3_keep_probe_turn_identity;
set local role service_role;
create temporary table first_writer_timeout (result jsonb not null);
grant select, insert on first_writer_timeout to service_role;
insert into first_writer_timeout select public.record_gate3_probe_timeout(
    'a9720000-0000-4000-8000-000000000009',
    '90300000-0000-4000-8000-000000000001');
select is((select result -> 'value' -> 'decision' from first_writer_timeout),
    (select result -> 'value' -> 'decision' from first_writer_probe),
    'expired timeout caller preserves the complete first probe decision');
select is((select result -> 'value' ->> 'probeId' from first_writer_timeout),
    (select result -> 'value' ->> 'probeId' from first_writer_probe),
    'expired timeout caller preserves the first probe identity');
select is((select result -> 'value' ->> 'sourceVersion' from first_writer_timeout),
    (select result -> 'value' ->> 'sourceVersion' from first_writer_probe),
    'expired timeout caller preserves the qualified source version');
reset role;
select is((select id::text from public.probes where answer_id =
    'a9720000-0000-4000-8000-000000000009'),
    (select result -> 'value' ->> 'probeId' from first_writer_probe),
    'original probe row identity remains after timeout replay');
select is((select count(*) from public.probes where answer_id =
    'a9720000-0000-4000-8000-000000000009'), 1::bigint,
    'timeout replay does not remove or duplicate the first probe');

insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', false,
    'synthetic-withdrawal');
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9720000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001') from provider_turn),
    null::jsonb, 'withdrawal hides a private timeout from the respondent path');
reset role;
select is((select count(*) from internal.gate3_probe_turns
    where decision_json ->> 'outcome' = 'timeout'), 2::bigint,
    'private audit retains both timeout outcomes after withdrawal');

select * from finish();
rollback;
