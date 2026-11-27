-- Disposable local browser fixture. `offer_id` is the first fictional offer
-- from the just-completed ten-approval study. Never run on hosted data.
begin;
create temp table gate5_same as
select answer.id as answer_id, answer.study_id, transcript.id as transcript_id,
    raw.raw_text as source_text
from public.invites as offer
join public.sessions as interview on interview.invite_id = offer.id
join public.answers as answer on answer.session_id = interview.id and answer.sequence = 1
join public.transcripts as transcript on transcript.answer_id = answer.id
join pii.transcript_raw as raw on raw.transcript_id = transcript.id
where offer.id = :'offer_id'::uuid and interview.state = 'approved';

do $$
begin
    if (select count(*) from gate5_same) <> 1
        or (select source_text from gate5_same)
            is distinct from 'Synthetic 😀 answer 1 about a meal decision'
        or (select count(*) from public.sessions
            where study_id = (select study_id from gate5_same)
                and state = 'approved') <> 10
        or (select count(*) from public.sessions
            where study_id = (select study_id from gate5_same)
                and state = 'removed') <> 1
        or not exists (select 1 from public.brief_versions
            where study_id = (select study_id from gate5_same)
              and brief_json @> '{"hypotheses":["A clear meal choice reduces hesitation."]}'::jsonb)
    then raise exception 'same-study fictional source or reviewed count missing'; end if;
end;
$$;

create temp table gate5_claim (payload jsonb);
grant select on gate5_same to service_role;
grant select, insert on gate5_claim to service_role;
set local role service_role;
insert into gate5_claim
select public.claim_gate1_answer_job((select answer_id from gate5_same));
do $$
begin
    if (select payload ->> 'answerId' from gate5_claim)
        is distinct from (select answer_id::text from gate5_same)
        or (public.complete_gate1_answer_job(
            (select answer_id from gate5_same),
            (select (payload ->> 'leaseId')::uuid from gate5_claim),
            supplied_redacted_text => (select source_text from gate5_same),
            supplied_redaction_passed => true,
            supplied_policy_digest => repeat('a', 64),
            supplied_qualification_digest => repeat('b', 64)) ->> 'status')
            is distinct from 'published'
    then raise exception 'same-study fictional source not qualified'; end if;
end;
$$;
reset role;

insert into public.reports (id, study_id, version, state, summary_json)
select 'a9800000-0000-4000-8000-000000000001', study_id, 1, 'ready',
    '{"raw":"private fictional summary"}'::jsonb from gate5_same;
insert into public.findings
    (id, report_id, study_id, position, claim, count, total, confidence)
select 'a9800000-0000-4000-8000-000000000002',
    'a9800000-0000-4000-8000-000000000001', study_id, 1,
    'Private fictional finding', 1, 10, 'low' from gate5_same;
insert into public.evidence_quotes
    (id, finding_id, transcript_id, study_id, start_char, end_char, text, source_version)
select 'a9800000-0000-4000-8000-000000000003',
    'a9800000-0000-4000-8000-000000000002',
    gate5_same.transcript_id, gate5_same.study_id,
    strpos(source.redacted_text, 'meal decision') - 1,
    strpos(source.redacted_text, 'meal decision') - 1 + char_length('meal decision'),
    'meal decision', source.redacted_source_version
from gate5_same
join public.transcripts as source on source.id = gate5_same.transcript_id
where strpos(source.redacted_text, 'meal decision') > 0;
do $$
begin
    if (select count(*) from public.evidence_quotes
        where id = 'a9800000-0000-4000-8000-000000000003') <> 1
    then raise exception 'same-study exact quote missing'; end if;
end;
$$;

create temp table gate5_quotes as
select jsonb_build_object('1', jsonb_build_array(jsonb_build_object(
    'studyId', study_id, 'transcriptId', transcript_id,
    'sourceVersion', source_version, 'startChar', start_char,
    'endChar', end_char, 'exactText', text))) as payload
from public.evidence_quotes
where id = 'a9800000-0000-4000-8000-000000000003';
create temp table gate5_reviews as
select jsonb_build_array(jsonb_build_object(
    'proposalId', 'a9800000-0000-4000-8000-000000000004',
    'candidate', (payload -> '1' -> 0) ||
        '{"rationale":"Fictional private reason"}'::jsonb,
    'privateRationale', 'Fictional private reason',
    'modelName', 'synthetic-model', 'modelVersion', 'fixture-v1',
    'promptVersion', 'fixture-prompt-v1', 'actorId', 'synthetic-reviewer',
    'causationId', 'a9800000-0000-4000-8000-000000000005',
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
        'executiveAnswer', 'One fictional respondent mentioned a meal decision',
        'themes', jsonb_build_array(jsonb_build_object(
            'claim', 'One respondent discussed a meal decision',
            'count', 1, 'total', 10, 'confidence', 'low',
            'supportingQuotes',
            jsonb_build_array((quotes -> '1' -> 0) ||
                '{"confidence":0.9}'::jsonb),
            'contradictingQuotes', '[]'::jsonb)),
        'hypotheses', '[{"hypothesis":"A clear meal choice reduces hesitation.","result":"untested"}]'::jsonb);
    if not public.publish_gate3_reviewed_report(
        'a9800000-0000-4000-8000-000000000001', summary,
        '{"a9800000-0000-4000-8000-000000000002":"One respondent discussed a meal decision"}',
        quotes, repeat('a', 64), repeat('b', 64),
        (select payload from gate5_reviews),
        '{"a9800000-0000-4000-8000-000000000002":1}')
    then raise exception 'same-study fictional report publication refused'; end if;
end;
$$;
reset role;
commit;
