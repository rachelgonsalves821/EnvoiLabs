-- Disposable Auth fixture only. Run after packages/db/seed.sql in a fresh
-- isolated local stack; never on a hosted database or real respondent.
begin;
update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text)
values ('a9700000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 99, 'Fictional question');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9700000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 100,
    now() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state)
values ('a9700000-0000-4000-8000-000000000003',
    'a9700000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
values ('a9700000-0000-4000-8000-000000000004',
    'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, provider, model, latency_ms, cost_micros)
values ('a9700000-0000-4000-8000-000000000005',
    'a9700000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001', 'typed', 'none', 0, 0);
insert into pii.transcript_raw (transcript_id, raw_text)
values ('a9700000-0000-4000-8000-000000000005', 'Fictional private source');
insert into internal.gate1_answer_jobs (answer_id)
values ('a9700000-0000-4000-8000-000000000004');
insert into public.consents (respondent_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001', purpose, true, 'fixture-v1'
from unnest(array['retention','researcher_access']) as purpose;
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));

create temp table gate5_lease (payload jsonb);
grant select, insert on gate5_lease to service_role;
set local role service_role;
insert into gate5_lease
select public.claim_gate1_answer_job('a9700000-0000-4000-8000-000000000004');
do $$
begin
    if (public.complete_gate1_answer_job(
        'a9700000-0000-4000-8000-000000000004',
        (select (payload ->> 'leaseId')::uuid from gate5_lease),
        supplied_redacted_text => 'A 😀 ordered soup.',
        supplied_redaction_passed => true,
        supplied_policy_digest => repeat('a', 64),
        supplied_qualification_digest => repeat('b', 64)) ->> 'status')
        is distinct from 'published' then raise exception 'fixture source not published'; end if;
end;
$$;
reset role;

insert into public.reports (id, study_id, version, state, summary_json)
values ('a9700000-0000-4000-8000-000000000006',
    '90600000-0000-4000-8000-000000000001', 1, 'ready',
    '{"raw":"private model summary"}');
insert into public.findings (id, report_id, study_id, position, claim, count, total, confidence)
values ('a9700000-0000-4000-8000-000000000007',
    'a9700000-0000-4000-8000-000000000006',
    '90600000-0000-4000-8000-000000000001', 1,
    'Private model claim', 1, 1, 'high');
insert into public.evidence_quotes
    (id, finding_id, transcript_id, study_id, start_char, end_char, text, source_version)
select 'a9700000-0000-4000-8000-000000000008',
    'a9700000-0000-4000-8000-000000000007', id, study_id,
    4, 16, 'ordered soup', redacted_source_version
from public.transcripts where id = 'a9700000-0000-4000-8000-000000000005';

create temp table gate5_quotes as
select jsonb_build_object('1', jsonb_build_array(jsonb_build_object(
    'studyId', study_id, 'transcriptId', transcript_id,
    'sourceVersion', source_version, 'startChar', start_char,
    'endChar', end_char, 'exactText', text))) as payload
from public.evidence_quotes where id = 'a9700000-0000-4000-8000-000000000008';
create temp table gate5_reviews as
select jsonb_build_array(jsonb_build_object(
    'proposalId', 'a9700000-0000-4000-8000-000000000021',
    'candidate', (payload -> '1' -> 0) || '{"rationale":"Private fictional reason"}'::jsonb,
    'privateRationale', 'Private fictional reason',
    'modelName', 'synthetic-model', 'modelVersion', 'fixture-v1',
    'promptVersion', 'fixture-prompt-v1', 'actorId', 'synthetic-reviewer',
    'causationId', 'a9700000-0000-4000-8000-000000000022',
    'findingPosition', 1, 'action', 'accept',
    'approvedQuote', payload -> '1' -> 0)) as payload
from gate5_quotes;
grant select on gate5_quotes, gate5_reviews to service_role;
set local role service_role;
do $$
declare
    quotes jsonb := (select payload from gate5_quotes);
    summary jsonb;
begin
    summary := jsonb_build_object('version', 2,
        'executiveAnswer', 'One fictional soup order',
        'themes', jsonb_build_array(jsonb_build_object(
            'claim', 'One respondent ordered soup', 'count', 1, 'total', 1,
            'confidence', 'high', 'supportingQuotes',
            jsonb_build_array((quotes -> '1' -> 0) || '{"confidence":0.9}'::jsonb),
            'contradictingQuotes', '[]'::jsonb)),
        'hypotheses', '[]'::jsonb);
    if not public.publish_gate3_reviewed_report(
        'a9700000-0000-4000-8000-000000000006', summary,
        '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
        quotes, repeat('a', 64), repeat('b', 64),
        (select payload from gate5_reviews),
        '{"a9700000-0000-4000-8000-000000000007":1}')
    then raise exception 'fictional report publication refused'; end if;
end;
$$;
reset role;
commit;
