begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
insert into internal.gate1_answer_jobs (answer_id, source_hash,
    completed_at, result_status, publication_policy_digest,
    publication_qualification_digest)
values ('a9700000-0000-4000-8000-000000000004',
    decode(repeat('c', 64), 'hex'), clock_timestamp(), 'published',
    repeat('a', 64), repeat('b', 64));
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', purpose, true, 'synthetic-only'
from unnest(array['retention', 'researcher_access']) as consent(purpose);

select ok(not has_function_privilege('authenticated',
    'public.read_gate3_ready_probe_turn(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.commit_gate3_probe_decision(uuid,uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    and not has_table_privilege('service_role', 'internal.gate3_probe_turns', 'SELECT'),
    'private ledger and source read are restricted to service RPCs');
set local role service_role;
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000), null::uuid,
    'AI follow-up defaults to denied');
reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'ai_followup', true,
    'synthetic-only');
create temporary table probe_ids (turn_id uuid not null);
grant select, insert on probe_ids to service_role;
set local role service_role;
select is(public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000002', 1000), null::uuid,
    'other respondent cannot begin the turn');
insert into probe_ids values (public.begin_gate3_probe_turn(
    'a9700000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001', 1000));
select ok((select turn_id is not null from probe_ids), 'explicit synthetic consent opens one turn');
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
create temporary table probe_actions (result jsonb not null);
grant select, insert on probe_actions to service_role;
insert into probe_actions
select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    public.read_gate3_ready_probe_turn(
        'a9700000-0000-4000-8000-000000000003', turn_id,
        '90300000-0000-4000-8000-000000000001') ->> 'transcriptRevision',
    jsonb_build_object('action', 'probe', 'turnId', turn_id,
        'uploadConfirmedAtMs', 1000, 'text', 'What made speed matter?'))
from probe_ids;
select is((select result ->> 'status' from probe_actions), 'committed',
    'the first decision commits');
select is((select result -> 'value' -> 'decision' ->> 'text' from probe_actions),
    'What made speed matter?', 'committed decision retains exact wording');
select is((select public.commit_gate3_probe_decision(
    'a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000004', turn_id,
    '90300000-0000-4000-8000-000000000001',
    (select result -> 'value' ->> 'transcriptRevision' from probe_actions),
    jsonb_build_object('action', 'next', 'turnId', turn_id,
        'outcome', 'no_probe')) -> 'value' -> 'decision' ->> 'text'
    from probe_ids), 'What made speed matter?',
    'competing decision observes the first writer');
select is((select count(*) from public.probes where answer_id =
    'a9700000-0000-4000-8000-000000000004'), 1::bigint,
    'first-writer replay creates one probe');
select is((select public.mark_gate3_probe_shown(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001', 1200)
    from probe_ids), 'recorded', 'shown receipt is recorded');
select is((select public.mark_gate3_probe_shown(
    'a9700000-0000-4000-8000-000000000003', turn_id,
    (select (result -> 'value' ->> 'probeId')::uuid from probe_actions),
    '90300000-0000-4000-8000-000000000001', 1200)
    from probe_ids), 'recorded', 'shown retry is idempotent');
reset role;
select ok((select shown_at is not null and browser_rendered_ms = 1200
    from internal.gate3_probe_turns where id = (select turn_id from probe_ids)),
    'server shown timestamp and browser monotonic metric stay separate');
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
