begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- The qualified-source PR supplies this column in the integration stack.
-- This fixture adds it only when the probe draft is tested in isolation.
alter table public.transcripts add column if not exists redacted_source_version
    uuid not null default gen_random_uuid();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text, max_probes)
values ('a9700000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1, 'How did you decide?', 2);
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9700000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160,
    clock_timestamp() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values ('a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', purpose, true, 'synthetic-only'
from unnest(array['retention', 'researcher_access']) as consent(purpose);

select ok(not has_function_privilege('authenticated',
    'public.read_gate3_ready_probe_turn(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.read_gate3_probe_pending(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.record_gate3_probe_upload_clock(uuid,uuid,uuid,double precision,text)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.list_gate3_probe_ready(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.commit_gate3_probe_decision(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    and not has_table_privilege('service_role', 'internal.gate3_probe_turns', 'SELECT'),
    'private ledger and source read are restricted to service RPCs');
select ok(not exists (select 1 from public.consents
    where respondent_id = '90500000-0000-4000-8000-000000000001'
        and study_id = '90600000-0000-4000-8000-000000000001'
        and purpose = 'ai_followup' and granted),
    'AI follow-up defaults to denied');
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
savepoint no_grant_answer;
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
values ('a9700000-0000-4000-8000-000000000008',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, redacted_text,
    provider, model, latency_ms, cost_micros)
values ('a9700000-0000-4000-8000-000000000009',
    'a9700000-0000-4000-8000-000000000008',
    '90600000-0000-4000-8000-000000000001',
    'I chose the nearby option.', 'typed', 'none', 0, 0);
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9700000-0000-4000-8000-000000000008',
    decode(repeat('d', 64), 'hex'), clock_timestamp(), 'published',
    repeat('a', 64), repeat('b', 64));
select is((select count(*) from internal.gate3_probe_opportunities
    where answer_id = 'a9700000-0000-4000-8000-000000000008'), 0::bigint,
    'answer saved without AI consent has no captured opportunity');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', true,
    'synthetic-late-grant');
set local role service_role;
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000008',
    '90300000-0000-4000-8000-000000000001', 900), null::uuid,
    'a later consent grant cannot begin an uncaptured answer');
select is(public.list_gate3_probe_ready(1), '[]'::jsonb,
    'late grant cannot create an uncaptured ready candidate');
select is(public.read_gate3_probe_pending(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), false,
    'the uncaptured answer never creates a pending state');
reset role;
rollback to savepoint no_grant_answer;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', true,
    'synthetic-only');
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
values ('a9700000-0000-4000-8000-000000000004',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, redacted_text,
    provider, model, latency_ms, cost_micros)
values ('a9700000-0000-4000-8000-000000000005',
    'a9700000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001',
    'I chose the faster option.', 'typed', 'none', 0, 0);
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9700000-0000-4000-8000-000000000004',
    decode(repeat('c', 64), 'hex'), clock_timestamp(), 'published',
    repeat('a', 64), repeat('b', 64));
create temporary table probe_ids (turn_id uuid not null);
grant select, insert on probe_ids to service_role;
set local role service_role;
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000002',
    'a9700000-0000-4000-8000-000000000010', 1000,
    'text_save_response'), 'stale',
    'another respondent cannot stamp the upload clock');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000010', 1000,
    'text_save_response'), 'recorded',
    'current answer stores its page-clock upload acknowledgement');
select is(public.list_gate3_probe_ready(1) #>> '{0,answerId}',
    'a9700000-0000-4000-8000-000000000004',
    'bounded ready selector returns the qualified captured answer ID only');
select is(public.list_gate3_probe_ready(1) #>> '{0,authUserId}',
    '90300000-0000-4000-8000-000000000001',
    'ready selector takes respondent identity from the database');
select is(public.list_gate3_probe_ready(1) #>> '{0,sessionId}',
    'a9700000-0000-4000-8000-000000000003',
    'ready selector binds the database session for future dispatch');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000010', 1000,
    'text_save_response'), 'recorded',
    'identical upload-clock retry is idempotent');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000011', 1000,
    'text_save_response'), 'stale',
    'a changed page clock cannot rewrite the first receipt');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000010', 1000,
    'voice_object_put'), 'stale',
    'text answers cannot claim a voice upload acknowledgement');
reset role;
select throws_ok($$
    update internal.gate3_probe_opportunities
    set browser_clock_origin_id = 'a9700000-0000-4000-8000-000000000011'
    where answer_id = 'a9700000-0000-4000-8000-000000000004'
$$, '23514', null, 'the private upload receipt cannot be rewritten');
set local role service_role;
select is(public.read_gate3_probe_pending(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000002'), false,
    'another respondent cannot see the pending decision state');
select is(public.read_gate3_probe_pending(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), true,
    'current consented answer holds the static next question while undecided');
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000002', 1000), null::uuid,
    'other respondent cannot begin the turn');
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1001), null::uuid,
    'legacy begin cannot replace a captured page-clock upload receipt');
reset role;
savepoint same_slot_before_turn;
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at)
values ('a9700000-0000-4000-8000-000000000012',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001',
    'text', 2, (select created_at + interval '1 second'
        from public.answers where id =
            'a9700000-0000-4000-8000-000000000004'));
set local role service_role;
select is(public.list_gate3_probe_ready(1), '[]'::jsonb,
    'new same-question answer removes old answer from batch ready selector');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001') #>> '{items,0,outcome}',
    'superseded', 'private denominator marks the older answer superseded');
select is(public.begin_gate3_probe_turn_with_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001'), null::uuid,
    'late old clock cannot begin after same-question replacement');
reset role;
rollback to savepoint same_slot_before_turn;
select is((select count(*) from internal.gate3_probe_turns
    where answer_id = 'a9700000-0000-4000-8000-000000000004'), 0::bigint,
    'mismatched legacy begin created no provider-ready turn');
set local role service_role;
insert into probe_ids values (public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000));
select ok((select turn_id is not null from probe_ids), 'explicit synthetic consent opens one turn');
select is(public.begin_gate3_probe_turn_with_clock(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001'),
    (select turn_id from probe_ids),
    'captured upload receipt replays the exact first turn');
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000),
    (select turn_id from probe_ids), 'begin retry returns the same turn');
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') ->> 'sourceText'
    from probe_ids), 'I chose the faster option.',
    'ready read contains qualified source only for the authorized service');
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_ids), null::jsonb,
    'no decision before commit');
reset role;
create temporary table probe_binding (turn_id uuid not null, ready jsonb not null);
grant select, insert on probe_binding to service_role;
set local role service_role;
insert into probe_binding select turn_id,
    public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') as ready
    from probe_ids;
reset role;
savepoint same_slot_after_turn;
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at)
values ('a9700000-0000-4000-8000-000000000012',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001',
    'text', 2, (select created_at + interval '1 second'
        from public.answers where id =
            'a9700000-0000-4000-8000-000000000004'));
set local role service_role;
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001')
    from probe_ids), null::jsonb,
    'existing old turn cannot provide source after same-question replacement');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001') #>> '{items,0,outcome}',
    'invalidated', 'private denominator invalidates the older turn');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (ready ->> 'sourceVersion')::uuid, ready ->> 'transcriptRevision',
    jsonb_build_object('action', 'next', 'turnId', turn_id,
        'outcome', 'no_probe')) ->> 'status' from probe_binding), 'stale',
    'old turn cannot commit after same-question replacement');
reset role;
rollback to savepoint same_slot_after_turn;
savepoint withdrawn_regrant;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', false,
    'synthetic-withdrawal');
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', true,
    'synthetic-regrant');
set local role service_role;
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_binding), null::jsonb,
    'withdrawal and regrant cannot expose the old provider-ready source');
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000), null::uuid,
    'withdrawal and regrant cannot reopen the old turn');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (ready ->> 'sourceVersion')::uuid, ready ->> 'transcriptRevision',
    jsonb_build_object('action', 'next', 'turnId', turn_id,
        'outcome', 'no_probe')) ->> 'status' from probe_binding), 'stale',
    'old source and turn cannot commit after consent receipt changes');
reset role;
rollback to savepoint withdrawn_regrant;
set local role service_role;
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001', gen_random_uuid(),
    public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'transcriptRevision',
    jsonb_build_object('action', 'next', 'turnId', turn_id,
        'outcome', 'no_probe')) ->> 'status' from probe_ids), 'stale',
    'a different source-version UUID cannot commit the same turn');
create temporary table probe_actions (result jsonb not null);
grant select, insert on probe_actions to service_role;
insert into probe_actions
select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'sourceVersion')::uuid,
    public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe', 'turnId', turn_id,
        'uploadConfirmedAtMs', 1000, 'text', 'What made speed matter?'))
from probe_ids;
select is((select result ->> 'status' from probe_actions), 'committed',
    'the first decision commits');
select is(public.read_gate3_probe_pending(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), false,
    'a committed decision clears the pending state');
select is(public.list_gate3_probe_ready(1), '[]'::jsonb,
    'committed decision leaves no ready candidate for another worker');
select is((select result -> 'value' -> 'decision' ->> 'text' from probe_actions),
    'What made speed matter?', 'committed decision retains exact wording');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (select (result -> 'value' ->> 'sourceVersion')::uuid from probe_actions),
    (select result -> 'value' ->> 'transcriptRevision' from probe_actions),
    jsonb_build_object('action', 'next', 'turnId', turn_id,
        'outcome', 'no_probe')) -> 'value' -> 'decision' ->> 'text'
    from probe_ids), 'What made speed matter?',
    'competing decision observes the first writer');
select is((select count(*) from public.probes where answer_id =
    'a9700000-0000-4000-8000-000000000004'), 1::bigint,
    'first-writer replay creates one probe');
-- The fixture advances the server clock fields without weakening production
-- immutability, to model a timely browser paint whose RPC arrives later.
reset role;
alter table internal.gate3_probe_turns disable trigger gate3_keep_probe_turn_identity;
update internal.gate3_probe_turns set
    server_upload_confirmed_at = clock_timestamp() - interval '10 seconds',
    transcript_ready_at = clock_timestamp() - interval '9 seconds',
    decision_deadline_at = clock_timestamp() - interval '4 seconds'
where id = (select turn_id from probe_ids);
alter table internal.gate3_probe_turns enable trigger gate3_keep_probe_turn_identity;
set local role service_role;
select is((select public.mark_gate3_probe_shown(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001', 1200)
    from probe_ids), 'stale',
    'legacy shown RPC cannot bypass a captured page-clock receipt');
select is((select public.mark_gate3_probe_shown_with_clock(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000011', 1200)
    from probe_ids), 'stale', 'a different page clock cannot mark the probe shown');
select is((select public.mark_gate3_probe_shown_with_clock(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000010', 1200)
    from probe_ids), 'recorded', 'paint before cutoff survives delayed RPC receipt');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001')
    #>> '{items,0,browserClockOriginId}',
    'a9700000-0000-4000-8000-000000000010',
    'private snapshot preserves the page-clock origin for scorer comparison');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001')
    #>> '{items,0,browserMeasurementComparable}', 'true',
    'same-origin shown receipt is a comparable browser measurement');
reset role;
select ok((select shown_at > decision_deadline_at
    from internal.gate3_probe_turns where id = (select turn_id from probe_ids)),
    'shown receipt records after the server decision deadline');
set local role service_role;
select is((select public.mark_gate3_probe_shown_with_clock(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000010', 1200)
    from probe_ids), 'recorded', 'shown retry is idempotent');
select is((select public.record_gate3_probe_render_terminal(turn_id,
    '90300000-0000-4000-8000-000000000001') ->> 'outcome'
    from probe_ids), 'shown',
    'a later terminal worker preserves the first shown receipt');
select is((select public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001') ->> 'text'),
    'What made speed matter?', 'current respondent sees only the committed probe');
reset role;
savepoint same_slot_after_commit;
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence, created_at)
values ('a9700000-0000-4000-8000-000000000012',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001',
    'text', 2, (select created_at + interval '1 second'
        from public.answers where id =
            'a9700000-0000-4000-8000-000000000004'));
set local role service_role;
select is(public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), null::jsonb,
    'respondent display hides a committed old probe after replacement');
reset role;
rollback to savepoint same_slot_after_commit;
set local role service_role;
select is(public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000002'), null::jsonb,
    'another respondent cannot read the probe');
select is((select public.record_gate3_probe_text_answer(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001',
    'The short route saved time.') -> 'answer' ->> 'probeId'
    from probe_ids),
    (select result -> 'value' ->> 'probeId' from probe_actions),
    'typed answer belongs to the shown committed probe');
select is((select public.record_gate3_probe_text_answer(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001',
    'The short route saved time.') -> 'answer' ->> 'id'
    from probe_ids), 'a9700000-0000-4000-8000-000000000006',
    'typed probe answer retry returns the same answer');
select is(public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), null::jsonb,
    'after probe answer the respondent advances to the static next core question');
reset role;
select ok((select shown_at is not null and browser_rendered_ms = 1200
    from internal.gate3_probe_turns where id = (select turn_id from probe_ids)),
    'server shown timestamp and browser monotonic metric stay separate');
savepoint same_text_source_rotation;
update public.transcripts set redacted_source_version = gen_random_uuid()
where answer_id = 'a9700000-0000-4000-8000-000000000004';
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_ids), null::jsonb,
    'same text under a new source UUID invalidates the committed turn');
reset role;
rollback to savepoint same_text_source_rotation;
update public.transcripts set redacted_text = 'The short route saved time.'
where answer_id = 'a9700000-0000-4000-8000-000000000006';
update internal.gate1_answer_jobs set source_hash = decode(repeat('e', 64), 'hex'),
    completed_at = clock_timestamp(), result_status = 'published',
    publication_policy_digest = repeat('a', 64),
    publication_qualification_digest = repeat('b', 64)
where answer_id = 'a9700000-0000-4000-8000-000000000006';
create temporary table second_probe_turn (turn_id uuid not null);
grant select, insert on second_probe_turn to service_role;
set local role service_role;
select is(public.begin_gate3_probe_turn_with_clock(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001'), null::uuid,
    'production begin cannot invent a missing second upload receipt');
reset role;
savepoint legacy_receipt_race;
set local role service_role;
insert into second_probe_turn values (public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001', 1400));
select ok((select turn_id is not null from second_probe_turn),
    'legacy begin can create a turn before the page receipt arrives');
reset role;
create temporary table second_probe_binding as
select id as turn_id, source_version, transcript_revision
from internal.gate3_probe_turns
where answer_id = 'a9700000-0000-4000-8000-000000000006';
grant select on second_probe_binding to service_role;
set local role service_role;
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from second_probe_turn),
    null::jsonb, 'legacy turn without a captured receipt exposes no model source');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001')
    #>> '{items,1,outcome}', 'invalidated',
    'a clockless legacy turn is invalidated in the private denominator');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006', turn_id,
    '90300000-0000-4000-8000-000000000001', source_version,
    transcript_revision, jsonb_build_object('action', 'next',
        'turnId', turn_id, 'outcome', 'no_probe')) ->> 'status'
    from second_probe_binding), 'stale',
    'legacy turn without a receipt cannot commit a model decision');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000012', 1500,
    'text_save_response'), 'recorded',
    'a later different immutable browser receipt can still be captured');
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from second_probe_turn),
    null::jsonb, 'mismatched later receipt cannot expose the old model source');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001')
    #>> '{items,1,currentTurn}', 'false',
    'mismatched later receipt cannot mark the turn current');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006', turn_id,
    '90300000-0000-4000-8000-000000000001', source_version,
    transcript_revision, jsonb_build_object('action', 'next',
        'turnId', turn_id, 'outcome', 'no_probe')) ->> 'status'
    from second_probe_binding), 'stale',
    'mismatched later receipt cannot commit the old turn');
reset role;
rollback to savepoint legacy_receipt_race;
set local role service_role;
insert into second_probe_turn values (public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001', 1400));
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000012', 1400,
    'text_save_response'), 'recorded',
    'matching later receipt authorizes the exact frozen turn on replay');
select is(public.record_gate3_probe_upload_clock(
    'a9700000-0000-4000-8000-000000000006',
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000012', 1400,
    'text_save_response'), 'recorded',
    'an identical receipt retry leaves the frozen clock identity intact');
select is((select public.read_gate3_ready_probe_turn(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') ->> 'probesUsed'
    from second_probe_turn), '1', 'second turn counts the first probe');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'sourceVersion')::uuid,
    public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe', 'turnId', turn_id,
        'uploadConfirmedAtMs', 1400, 'text', 'What else made the route useful?'))
    ->> 'status' from second_probe_turn), 'committed',
    'second probe commits under the same guide cap');
select is((select public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001') ->> 'text'),
    'What else made the route useful?', 'second probe is the current respondent prompt');
select is((select public.mark_gate3_probe_shown_with_clock(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (public.read_gate3_respondent_probe(
        'a9700000-0000-4000-8000-000000000003',
        '90300000-0000-4000-8000-000000000001') ->> 'probeId')::uuid,
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000012', 7401)
    from second_probe_turn), 'stale', 'late browser paint cannot claim a timely receipt');
select is((select public.mark_gate3_probe_shown_with_clock(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (public.read_gate3_respondent_probe(
        'a9700000-0000-4000-8000-000000000003',
        '90300000-0000-4000-8000-000000000001') ->> 'probeId')::uuid,
    '90300000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000012', 1500)
    from second_probe_turn), 'recorded', 'second probe has its own shown receipt');
select is(public.read_gate3_probe_opportunity_snapshot(
    '90600000-0000-4000-8000-000000000001')
    #>> '{items,1,browserMeasurementComparable}', 'true',
    'matching second page-clock receipt is a comparable shown sample');
select is((select public.record_gate3_probe_text_answer(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (public.read_gate3_respondent_probe(
        'a9700000-0000-4000-8000-000000000003',
        '90300000-0000-4000-8000-000000000001') ->> 'probeId')::uuid,
    'a9700000-0000-4000-8000-000000000007',
    '90300000-0000-4000-8000-000000000001', 'It also cost less.')
    -> 'answer' ->> 'sequence' from second_probe_turn), '1012',
    'second probe reply has a distinct sequence');
reset role;
update public.transcripts set redacted_text = 'It also cost less.'
where answer_id = 'a9700000-0000-4000-8000-000000000007';
update internal.gate1_answer_jobs set source_hash = decode(repeat('f', 64), 'hex'),
    completed_at = clock_timestamp(), result_status = 'published',
    publication_policy_digest = repeat('a', 64),
    publication_qualification_digest = repeat('b', 64)
where answer_id = 'a9700000-0000-4000-8000-000000000007';
set local role service_role;
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000007',
    '90300000-0000-4000-8000-000000000001', 1600), null::uuid,
    'a third probe is denied by the full guide-question chain cap');
reset role;
insert into public.guide_questions (id, study_id, position, text, max_probes)
values ('a9700000-0000-4000-8000-000000000008',
    '90600000-0000-4000-8000-000000000001', 2, 'What came next?', 0);
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence)
values ('a9700000-0000-4000-8000-000000000009',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000008', 'text', 2);
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001')
    from second_probe_turn), null::jsonb,
    'a later core answer invalidates a second probe despite its high sequence');
select is(public.read_gate3_respondent_probe(
    'a9700000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000001'), null::jsonb,
    'later core answer hides an unanswered probe on reload');
reset role;
select throws_ok($$update internal.gate3_probe_turns
    set transcript_revision = repeat('f', 64)$$,
    '23514', 'probe turn is immutable',
    'the stored source revision cannot be rewritten');

insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', false,
    'synthetic-withdrawal');
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_ids), null::jsonb,
    'revoked consent hides even a committed decision');
select is((select public.mark_gate3_probe_shown(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001', 1300)
    from probe_ids), 'stale', 'withdrawal blocks shown replay');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', true,
    'synthetic-restored');
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_ids), null::jsonb,
    'a later consent grant cannot reactivate the old decision');
reset role;
update internal.gate1_answer_jobs set publication_qualification_digest = repeat('d', 64)
where answer_id = 'a9700000-0000-4000-8000-000000000004';
update internal.gate1_redaction_policies set qualification_digest = repeat('d', 64)
where policy_digest = repeat('a', 64);
set local role service_role;
select is((select public.read_gate3_committed_probe(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    '90300000-0000-4000-8000-000000000001') from probe_ids), null::jsonb,
    'same-text publication under a new receipt makes the old fingerprint stale');
select is((select public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000)), null::uuid,
    'an old turn cannot be rebound to the newer source receipt');
reset role;

select * from finish();
rollback;
