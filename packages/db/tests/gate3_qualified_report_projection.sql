begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, research;
select no_plan();

update public.studies set state = 'fielding'
where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text)
values ('a9700000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001', 99, 'Synthetic question');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9700000-0000-4000-8000-000000000002', '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160, now() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state)
values ('a9700000-0000-4000-8000-000000000003', 'a9700000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
values ('a9700000-0000-4000-8000-000000000004', 'a9700000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 'a9700000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, provider, model, latency_ms, cost_micros)
values ('a9700000-0000-4000-8000-000000000005', 'a9700000-0000-4000-8000-000000000004',
    '90600000-0000-4000-8000-000000000001', 'typed', 'none', 0, 0);
insert into pii.transcript_raw (transcript_id, raw_text)
values ('a9700000-0000-4000-8000-000000000005', 'Synthetic private source');
insert into internal.gate1_answer_jobs (answer_id) values ('a9700000-0000-4000-8000-000000000004');
insert into public.consents (respondent_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001', purpose, true, 'fixture-v1'
from unnest(array['retention','researcher_access']) as purpose;
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
insert into auth.users (id) values ('a9700000-0000-4000-8000-000000000009');
insert into public.organizations (id, name)
values ('a9700000-0000-4000-8000-000000000010', 'Other synthetic tenant');
insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
values ('a9700000-0000-4000-8000-000000000009', 'a9700000-0000-4000-8000-000000000010',
    'fixture-v1', now());

create temp table claimed (payload jsonb);
grant select, insert on claimed to service_role;
set local role service_role;
insert into claimed select public.claim_gate1_answer_job('a9700000-0000-4000-8000-000000000004');
select is(public.complete_gate1_answer_job(
    'a9700000-0000-4000-8000-000000000004', (select (payload ->> 'leaseId')::uuid from claimed),
    supplied_redacted_text => 'A 😀 ordered soup.', supplied_redaction_passed => true,
    supplied_policy_digest => repeat('a', 64), supplied_qualification_digest => repeat('b', 64)
) ->> 'status', 'published', 'qualified synthetic source publishes');
reset role;

-- The reviewed publisher uses the current ten-person approved population,
-- including nine synthetic completed respondents without supporting quotes.
insert into auth.users (id)
select ('a9710000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
from generate_series(1, 9) as n;
insert into public.respondents (id, auth_user_id, age_attested_at)
select ('a9720000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9710000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    clock_timestamp() from generate_series(1, 9) as n;
insert into public.consents (respondent_id, purpose, granted, text_version)
select ('a9720000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    purpose, true, 'fixture-v1'
from generate_series(1, 9) as n
cross join unnest(array['retention', 'researcher_access']) as purpose;
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at)
select ('a9730000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    '90600000-0000-4000-8000-000000000001',
    ('a9720000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'accepted', 160, clock_timestamp() + interval '1 day'
from generate_series(1, 9) as n;
insert into public.sessions (id, invite_id, study_id, state, submitted_at)
select ('a9740000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9730000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    '90600000-0000-4000-8000-000000000001', 'submitted', clock_timestamp()
from generate_series(1, 9) as n;
update public.sessions set state = 'submitted', submitted_at = clock_timestamp()
where id = 'a9700000-0000-4000-8000-000000000003';
insert into public.quality_scores (session_id, score, components_json, decision)
select id, 90, '{}'::jsonb, 'approve' from public.sessions
where study_id = '90600000-0000-4000-8000-000000000001';
update public.sessions set state = 'approved'
where study_id = '90600000-0000-4000-8000-000000000001';

insert into public.reports (id, study_id, version, state, summary_json)
values ('a9700000-0000-4000-8000-000000000006', '90600000-0000-4000-8000-000000000001',
    1, 'ready', '{"raw":"private model summary"}');
insert into public.findings (id, report_id, study_id, position, claim, count, total, confidence)
values ('a9700000-0000-4000-8000-000000000007', 'a9700000-0000-4000-8000-000000000006',
    '90600000-0000-4000-8000-000000000001', 1, 'Private model claim', 1, 10, 'low');
insert into public.evidence_quotes (id, finding_id, transcript_id, study_id, start_char, end_char, text, source_version)
select 'a9700000-0000-4000-8000-000000000008', 'a9700000-0000-4000-8000-000000000007', id,
    study_id, 4, 16, 'ordered soup', redacted_source_version
from public.transcripts where id = 'a9700000-0000-4000-8000-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'legacy report has no public projection');
select is((select count(*) from research.evidence_quotes), 0::bigint, 'quote cannot bypass unqualified report');
select throws_ok($$select claim from public.findings$$, '42501', null, 'raw model claim cannot be read');
reset role;

create temp table expected_report_quotes as
select jsonb_build_object('1', jsonb_build_array(jsonb_build_object(
    'studyId', study_id, 'transcriptId', transcript_id,
    'sourceVersion', source_version, 'startChar', start_char,
    'endChar', end_char, 'exactText', text))) as payload
from public.evidence_quotes where id = 'a9700000-0000-4000-8000-000000000008';
grant select on expected_report_quotes to service_role, authenticated;
create temp table expected_report_summary as
select jsonb_build_object('version', 2, 'executiveAnswer', 'One soup order',
    'hypotheses', '[]'::jsonb, 'themes', jsonb_build_array(jsonb_build_object(
        'claim', 'One respondent ordered soup', 'count', 1, 'total', 10,
        'confidence', 'low', 'supportingQuotes', jsonb_build_array(
            (payload -> '1' -> 0) || '{"confidence":0.9}'::jsonb),
        'contradictingQuotes', '[]'::jsonb))) as payload
from expected_report_quotes;
grant select on expected_report_summary to service_role;
grant select on expected_report_summary to gate3_report_qualifier;
create temp table expected_reviews as
select jsonb_build_array(jsonb_build_object(
    'proposalId', 'a9700000-0000-4000-8000-000000000021',
    'candidate', (payload -> '1' -> 0) || '{"rationale":"Private model reason"}'::jsonb,
    'privateRationale', 'Private model reason',
    'modelName', 'synthetic-model', 'modelVersion', 'fixture-v1',
    'promptVersion', 'fixture-prompt-v1', 'actorId', 'synthetic-reviewer',
    'causationId', 'a9700000-0000-4000-8000-000000000022',
    'findingPosition', 1, 'action', 'accept',
    'approvedQuote', payload -> '1' -> 0)) as payload
from expected_report_quotes;
grant select on expected_reviews to service_role;
set local role service_role;
select throws_ok($$update public.reports set qualified_summary_json = '{"raw":"Ada Example"}'
    where id = 'a9700000-0000-4000-8000-000000000006'$$,
    '42501', null, 'service cannot directly write a qualified summary');
select throws_ok($$update public.findings set qualified_claim = 'Ada Example'
    where id = 'a9700000-0000-4000-8000-000000000007'$$,
    '42501', null, 'service cannot directly write a qualified claim');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    '{"1":[]}', repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'missing cited quote cannot be published');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":2}'), false,
    'caller cannot substitute a finding position');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select jsonb_set(payload, '{1}', (payload -> '1') || (payload -> '1'))
        from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'extra cited quote cannot be published');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select jsonb_set(payload, '{1,0,studyId}',
        '"00000000-0000-4000-8000-000000000001"'::jsonb) from expected_report_quotes),
    repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'quote from a different study cannot be published');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes}', '[]'::jsonb) from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'missing summary theme cannot publish a finding');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes}', (payload -> 'themes') || (payload -> 'themes'))
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'extra summary theme cannot publish');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(jsonb_set(payload, '{themes,0,count}', '2'::jsonb),
        '{themes,0,total}', '2'::jsonb) from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'schema-valid 2 of 2 theme cannot describe persisted 1 of 1 finding');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes,0,claim}', '"Different qualified claim"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'summary claim must equal the qualified finding claim');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes,0,confidence}', '"medium"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'summary confidence must equal the persisted finding confidence');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes,0,supportingQuotes,0,exactText}',
        '"Different quote"'::jsonb) from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'summary quote set must equal persisted verified quotes');
select is((select count(*) from pii.gate3_report_publications where report_id =
    'a9700000-0000-4000-8000-000000000006'), 0::bigint,
    'rejected summary variants leave no publication receipt');
reset role;
update public.findings set position = 2
where id = 'a9700000-0000-4000-8000-000000000007';
select is(internal.gate3_summary_matches_findings(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes)), false,
    'summary theme index must match the stored 1-based finding position');
update public.findings set position = 1
where id = 'a9700000-0000-4000-8000-000000000007';
update public.findings set total = 2, confidence = 'high'
where id = 'a9700000-0000-4000-8000-000000000007';
set local role service_role;
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(jsonb_set(payload, '{themes,0,total}', '2'::jsonb),
        '{themes,0,confidence}', '"high"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'high confidence requires at least 60 percent support');
reset role;
update public.findings set total = 4, confidence = 'medium'
where id = 'a9700000-0000-4000-8000-000000000007';
set local role service_role;
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(jsonb_set(payload, '{themes,0,total}', '4'::jsonb),
        '{themes,0,confidence}', '"medium"'::jsonb) from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'medium confidence requires at least 30 percent support');
reset role;
update public.findings set total = 10, confidence = 'low'
where id = 'a9700000-0000-4000-8000-000000000007';
set local role service_role;
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'direct reviewed publisher denies a missing support attestation');
select ok(not has_function_privilege('service_role',
    'public.attest_gate3_reviewed_support(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
    'publisher service cannot impersonate a reviewer support attestation');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is(public.attest_gate3_reviewed_support(
    'a9700000-0000-4000-8000-000000000006',
    'a9700000-0000-4000-8000-000000000007',
    '90200000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000050',
    (select jsonb_build_array(jsonb_build_object('transcriptId',
        payload #>> '{1,0,transcriptId}', 'sourceVersion',
        payload #>> '{1,0,sourceVersion}')) from expected_report_quotes)), false,
    'reviewer support attestation requires MFA');
set local request.jwt.claims = '{"sub":"a9700000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2"}';
select is(public.attest_gate3_reviewed_support(
    'a9700000-0000-4000-8000-000000000006',
    'a9700000-0000-4000-8000-000000000007',
    '90200000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000050',
    (select jsonb_build_array(jsonb_build_object('transcriptId',
        payload #>> '{1,0,transcriptId}', 'sourceVersion',
        payload #>> '{1,0,sourceVersion}')) from expected_report_quotes)), false,
    'other tenant cannot impersonate the approved reviewer');
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.attest_gate3_reviewed_support(
    'a9700000-0000-4000-8000-000000000006',
    'a9700000-0000-4000-8000-000000000007',
    '90200000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000050',
    (select jsonb_build_array(jsonb_build_object('transcriptId',
        payload #>> '{1,0,transcriptId}', 'sourceVersion',
        payload #>> '{1,0,sourceVersion}')) from expected_report_quotes)), true,
    'reviewer separately attests the current exact supporting source');
reset role;
update public.findings set count = 7
where id = 'a9700000-0000-4000-8000-000000000007';
select is(internal.gate3_reviewed_support_current(
    'a9700000-0000-4000-8000-000000000006', repeat('a', 64), repeat('b', 64)),
    false, 'direct publication guard rejects an inflated seven of ten claim');
update public.findings set count = 1
where id = 'a9700000-0000-4000-8000-000000000007';
select is(internal.gate3_reviewed_support_current(
    'a9700000-0000-4000-8000-000000000006', repeat('a', 64), repeat('b', 64)),
    true, 'exact one-supporter claim is current before publication');
set local role service_role;
select is(jsonb_array_length(public.read_gate3_reviewed_support_snapshot(
    'a9700000-0000-4000-8000-000000000006') -> 'approvedRespondentIds'),
    10, 'private snapshot has exactly ten current approved respondents');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{executiveAnswer}',
        '"Ada Example, ada@example.test, +1 555 0100, 12 Main Street, Acme Corp"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'direct service RPC cannot publish an unqualified public executive answer');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{hypotheses}',
        '[{"hypothesis":"Ada Example at Acme Corp, 12 Main Street", "result":"supported"}]'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'direct service RPC cannot publish unqualified public hypothesis text');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes,0,claim}',
        '"Ada Example ada@example.test +1 555 0100 12 Main Street Acme Corp"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"Ada Example ada@example.test +1 555 0100 12 Main Street Acme Corp"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'direct service RPC cannot publish an unqualified public claim');
select throws_ok($$insert into pii.gate3_public_text_qualifications
    (report_id, payload_digest, policy_digest, qualification_digest, qualifier_receipt_id)
    values ('a9700000-0000-4000-8000-000000000006', repeat('a',64),
        repeat('a',64), repeat('b',64), gen_random_uuid())$$,
    '42501', null, 'service role cannot mint its own public-text receipt');
select ok(not has_function_privilege('service_role',
    'public.record_gate3_public_text_qualification(uuid,jsonb,jsonb,text,text,uuid)',
    'EXECUTE') and not has_function_privilege('authenticated',
    'public.record_gate3_public_text_qualification(uuid,jsonb,jsonb,text,text,uuid)',
    'EXECUTE') and has_function_privilege('gate3_report_qualifier',
    'public.record_gate3_public_text_qualification(uuid,jsonb,jsonb,text,text,uuid)',
    'EXECUTE'), 'only separate no-login qualifier may record public-text approval');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a',64), repeat('b',64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'qualifier failure withholds report even when source and support are current');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports where id =
    'a9700000-0000-4000-8000-000000000006'), 0::bigint,
    'no direct-RPC sentinel can make the report readable');
reset role;
-- Synthetic fixture stands in for an independently authorized qualifier.
-- The test connection gets temporary membership only inside this rolled-back fixture.
grant gate3_report_qualifier to postgres;
grant usage on schema extensions to gate3_report_qualifier;
set local role gate3_report_qualifier;
select is(public.record_gate3_public_text_qualification(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    repeat('a',64), repeat('b',64),
    'a9700000-0000-4000-8000-000000000052'), true,
    'separate synthetic qualifier records the exact approved public text');
select is(public.record_gate3_public_text_qualification(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    repeat('a',64), repeat('b',64),
    'a9700000-0000-4000-8000-000000000052'), true,
    'exact qualifier receipt replay is idempotent');
select is(public.record_gate3_public_text_qualification(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{executiveAnswer}', '"Changed text"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    repeat('a',64), repeat('b',64),
    'a9700000-0000-4000-8000-000000000052'), false,
    'same receipt cannot approve changed public text');
reset role;
set local role service_role;
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{executiveAnswer}',
        '"Ada Example ada@example.test +1 555 0100 12 Main Street Acme Corp"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a',64), repeat('b',64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'safe receipt cannot be reused for an unqualified executive answer');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{hypotheses}',
        '[{"hypothesis":"Ada Example at Acme Corp, 12 Main Street", "result":"supported"}]'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a',64), repeat('b',64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'safe receipt cannot be reused for unqualified hypothesis text');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select jsonb_set(payload, '{themes,0,claim}',
        '"Ada Example ada@example.test +1 555 0100 12 Main Street Acme Corp"'::jsonb)
        from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"Ada Example ada@example.test +1 555 0100 12 Main Street Acme Corp"}',
    (select payload from expected_report_quotes), repeat('a',64), repeat('b',64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'safe receipt cannot be reused for unqualified claim text');
select ok(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes),
    repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'),
    'trusted publisher binds exact qualified output and private decision');
select ok(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'),
    'exact publication retry returns prior result');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000006',
    (select payload from expected_report_summary),
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    (select payload from expected_report_quotes), repeat('a', 64), repeat('b', 64),
    (select jsonb_set(payload, '{0,actorId}', '"different-reviewer"'::jsonb)
        from expected_reviews),
    '{"a9700000-0000-4000-8000-000000000007":1}'), false,
    'changed actor cannot replay an approved publication');
select throws_ok($$select public.publish_gate3_qualified_report(
    'a9700000-0000-4000-8000-000000000006', '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, repeat('a', 64), repeat('b', 64))$$,
    '42501', null, 'service cannot bypass reviewed publication');
reset role;
select is((select count(*) from pii.gate3_evidence_proposals where report_id =
    'a9700000-0000-4000-8000-000000000006'), 1::bigint,
    'one private proposal survives exact publication retry');
select is((select count(*) from pii.gate3_evidence_decisions where proposal_id =
    'a9700000-0000-4000-8000-000000000021'), 1::bigint,
    'one private decision survives exact publication retry');

set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 1::bigint, 'qualified report is visible to MFA tenant researcher');
select is((select claim from research.findings), 'One respondent ordered soup', 'only qualified claim is projected');
select is((select text from research.evidence_quotes), 'ordered soup', 'exact Unicode codepoint span is projected');
select ok(public.read_gate3_qualified_report(
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006') is not null,
    'qualified reader returns current report to MFA tenant');
reset role;
update public.findings set count = 0
where id = 'a9700000-0000-4000-8000-000000000007';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'changed finding count invalidates the whole report receipt');
reset role;
update public.findings set count = 1
where id = 'a9700000-0000-4000-8000-000000000007';
update public.findings set confidence = 'high'
where id = 'a9700000-0000-4000-8000-000000000007';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'changed confidence invalidates the whole report receipt');
reset role;
update public.findings set confidence = 'low'
where id = 'a9700000-0000-4000-8000-000000000007';
insert into public.evidence_quotes
    (id, finding_id, transcript_id, study_id, start_char, end_char, text, source_version)
select 'a9700000-0000-4000-8000-000000000011',
    'a9700000-0000-4000-8000-000000000007', id, study_id,
    4, 16, 'ordered soup', redacted_source_version
from public.transcripts where id = 'a9700000-0000-4000-8000-000000000005';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'added valid quote invalidates the whole report receipt');
select is((select count(*) from research.evidence_quotes), 0::bigint,
    'added quote cannot appear while its report receipt is stale');
reset role;
delete from public.evidence_quotes where id = 'a9700000-0000-4000-8000-000000000011';
set local role authenticated;
select is((select count(*) from research.reports), 1::bigint,
    'restoring exact published rows restores receipt visibility');
reset role;
update public.reports set qualified_summary_json = '{"raw":"Ada Example"}'
where id = 'a9700000-0000-4000-8000-000000000006';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'privileged post-publication text mutation invalidates its receipt');
reset role;
update public.reports set qualified_summary_json =
    (select payload from expected_report_summary)
where id = 'a9700000-0000-4000-8000-000000000006';
insert into public.reports (id, study_id, version, state, summary_json)
values ('a9700000-0000-4000-8000-000000000030',
    '90600000-0000-4000-8000-000000000001', 2, 'ready',
    '{"raw":"private second summary"}');
insert into public.findings
    (id, report_id, study_id, position, claim, count, total, confidence)
values ('a9700000-0000-4000-8000-000000000031',
    'a9700000-0000-4000-8000-000000000030',
    '90600000-0000-4000-8000-000000000001', 1, 'Private second claim', 1, 10, 'low');
insert into public.evidence_quotes
    (id, finding_id, transcript_id, study_id, start_char, end_char, text, source_version)
select 'a9700000-0000-4000-8000-000000000032',
    'a9700000-0000-4000-8000-000000000031', id, study_id,
    4, 16, 'ordered soup', redacted_source_version
from public.transcripts where id = 'a9700000-0000-4000-8000-000000000005';
create temp table edited_report_quotes as
select jsonb_build_object('1', jsonb_build_array(jsonb_build_object(
    'studyId', study_id, 'transcriptId', transcript_id,
    'sourceVersion', source_version, 'startChar', start_char,
    'endChar', end_char, 'exactText', text))) as payload
from public.evidence_quotes where id = 'a9700000-0000-4000-8000-000000000032';
create temp table edited_report_summary as
select jsonb_build_object('version', 2, 'executiveAnswer', 'Edited soup summary',
    'hypotheses', '[]'::jsonb, 'themes', jsonb_build_array(jsonb_build_object(
        'claim', 'Qualified edited claim', 'count', 1, 'total', 10,
        'confidence', 'low', 'supportingQuotes', jsonb_build_array(
            (payload -> '1' -> 0) || '{"confidence":0.9}'::jsonb),
        'contradictingQuotes', '[]'::jsonb))) as payload
from edited_report_quotes;
grant select on edited_report_summary to service_role;
grant select on edited_report_summary to gate3_report_qualifier;
create temp table edited_reviews as
select jsonb_build_array(
    jsonb_build_object('proposalId', 'a9700000-0000-4000-8000-000000000033',
        'candidate', (payload -> '1' -> 0) || '{"rationale":"Private edit reason"}'::jsonb,
        'privateRationale', 'Private edit reason', 'modelName', 'synthetic-model',
        'modelVersion', 'fixture-v2', 'promptVersion', 'fixture-prompt-v2',
        'actorId', 'synthetic-reviewer',
        'causationId', 'a9700000-0000-4000-8000-000000000034',
        'findingPosition', 1, 'action', 'edit', 'editedClaim', 'Qualified edited claim',
        'approvedQuote', payload -> '1' -> 0),
    jsonb_build_object('proposalId', 'a9700000-0000-4000-8000-000000000035',
        'candidate', (payload -> '1' -> 0) || '{"rationale":"Private drop reason"}'::jsonb,
        'privateRationale', 'Private drop reason', 'modelName', 'synthetic-model',
        'modelVersion', 'fixture-v2', 'promptVersion', 'fixture-prompt-v2',
        'actorId', 'synthetic-reviewer',
        'causationId', 'a9700000-0000-4000-8000-000000000036',
        'findingPosition', 1, 'action', 'drop', 'approvedQuote', null)) as payload
from edited_report_quotes;
grant select on edited_report_quotes, edited_reviews to service_role;
grant select on edited_report_quotes to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.attest_gate3_reviewed_support(
    'a9700000-0000-4000-8000-000000000030',
    'a9700000-0000-4000-8000-000000000031',
    '90200000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000051',
    (select jsonb_build_array(jsonb_build_object('transcriptId',
        payload #>> '{1,0,transcriptId}', 'sourceVersion',
        payload #>> '{1,0,sourceVersion}')) from edited_report_quotes)), true,
    'second report version has a separate reviewed source attestation');
reset role;
set local role gate3_report_qualifier;
select is(public.record_gate3_public_text_qualification(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    repeat('a',64), repeat('b',64),
    'a9700000-0000-4000-8000-000000000053'), true,
    'next report version has its own independently qualified public text');
reset role;
set local role service_role;
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    (select payload from edited_report_quotes), repeat('a', 64), repeat('b', 64),
    (select jsonb_set(payload, '{0,approvedQuote}', 'null'::jsonb)
        from edited_reviews),
    '{"a9700000-0000-4000-8000-000000000031":1}'), false,
    'publication refuses an edit with no approved quote');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    (select payload from edited_report_quotes), repeat('a', 64), repeat('b', 64),
    (select jsonb_set(payload, '{0,editedClaim}', '"Different claim"'::jsonb)
        from edited_reviews),
    '{"a9700000-0000-4000-8000-000000000031":1}'), false,
    'edited claim must equal qualified published claim');
select is(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    (select payload from edited_report_quotes), repeat('a', 64), repeat('b', 64),
    (select jsonb_set(payload, '{0,editedQuoteText}', '"Different quote"'::jsonb)
        from edited_reviews),
    '{"a9700000-0000-4000-8000-000000000031":1}'), false,
    'edited quote must equal approved published quote');
select ok(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    (select payload from edited_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from edited_reviews),
    '{"a9700000-0000-4000-8000-000000000031":1}'),
    'edit and drop decisions commit with the reviewed report');
select ok(public.publish_gate3_reviewed_report(
    'a9700000-0000-4000-8000-000000000030',
    (select payload from edited_report_summary),
    '{"a9700000-0000-4000-8000-000000000031":"Qualified edited claim"}',
    (select payload from edited_report_quotes), repeat('a', 64), repeat('b', 64),
    (select payload from edited_reviews),
    '{"a9700000-0000-4000-8000-000000000031":1}'),
    'edit/drop retry returns prior decisions');
reset role;
select is((select count(*) from pii.gate3_evidence_decisions
    where proposal_id in ('a9700000-0000-4000-8000-000000000033',
        'a9700000-0000-4000-8000-000000000035')), 2::bigint,
    'edit and drop decisions are appended exactly once');
select is((select count(*) from pii.gate3_report_publications where report_id =
    'a9700000-0000-4000-8000-000000000030'), 1::bigint,
    'one publication receipt survives edit/drop retry');
set local role service_role;
select ok(public.record_gate3_withheld_proposal(
    '90600000-0000-4000-8000-000000000001', null,
    'a9700000-0000-4000-8000-000000000040',
    '{"exactText":"Private rejected candidate"}', 'synthetic-model', 'fixture-v2',
    'fixture-prompt-v2', 'Source did not support claim', 'synthetic-reviewer',
    'a9700000-0000-4000-8000-000000000041', 'Evidence withheld'),
    'rejected proposal gets private drop record without publication');
select ok(public.record_gate3_withheld_proposal(
    '90600000-0000-4000-8000-000000000001', null,
    'a9700000-0000-4000-8000-000000000040',
    '{"exactText":"Private rejected candidate"}', 'synthetic-model', 'fixture-v2',
    'fixture-prompt-v2', 'Source did not support claim', 'synthetic-reviewer',
    'a9700000-0000-4000-8000-000000000041', 'Evidence withheld'),
    'exact withheld-proposal replay is idempotent');
select is(public.record_gate3_withheld_proposal(
    '90600000-0000-4000-8000-000000000001', null,
    'a9700000-0000-4000-8000-000000000040',
    '{"exactText":"Private rejected candidate"}', 'synthetic-model', 'fixture-v2',
    'fixture-prompt-v2', 'Source did not support claim', 'synthetic-reviewer',
    'a9700000-0000-4000-8000-000000000041', 'Changed reason'), false,
    'changed withheld reason cannot replay');
reset role;
select is((select count(*) from pii.gate3_evidence_decisions where proposal_id =
    'a9700000-0000-4000-8000-000000000040'), 1::bigint,
    'withheld proposal has one append-only decision');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from research.reports), 0::bigint, 'pre-MFA researcher sees no report');
select is(public.read_gate3_qualified_report(
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006'), null::jsonb,
    'reader refuses pre-MFA access');
set local request.jwt.claims = '{"sub":"a9700000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'other tenant sees no report');
select is(public.read_gate3_qualified_report(
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006'), null::jsonb,
    'reader refuses other-tenant access');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.read_gate3_current_qualified_report(
    '90600000-0000-4000-8000-000000000001') #>> '{report,id}',
    'a9700000-0000-4000-8000-000000000030',
    'current reader selects latest qualified version');
reset role;
update public.reports set qualified_summary_json = '{"raw":"withheld"}'
where id = 'a9700000-0000-4000-8000-000000000030';
set local role authenticated;
select is(public.read_gate3_current_qualified_report(
    '90600000-0000-4000-8000-000000000001'), null::jsonb,
    'withheld latest version never falls back to older qualified report');
reset role;
update public.reports set qualified_summary_json =
    (select payload from edited_report_summary)
where id = 'a9700000-0000-4000-8000-000000000030';

insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('c', 64), repeat('b', 64));
update public.reports set qualified_policy_digest = repeat('c', 64)
where id = 'a9700000-0000-4000-8000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports
    where id = 'a9700000-0000-4000-8000-000000000006'), 0::bigint,
    'report receipt must match each cited source');
reset role;
update public.reports set qualified_policy_digest = repeat('a', 64)
where id = 'a9700000-0000-4000-8000-000000000006';

update public.evidence_quotes set text = 'not the source'
where id = 'a9700000-0000-4000-8000-000000000008';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports
    where id = 'a9700000-0000-4000-8000-000000000006'), 0::bigint,
    'mismatched quote text hides report');
reset role;
update public.evidence_quotes set text = 'ordered soup'
where id = 'a9700000-0000-4000-8000-000000000008';
update internal.gate1_redaction_policies set revoked_at = now() where policy_digest = repeat('a', 64);
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint, 'revoked qualification hides report');
reset role;
update internal.gate1_redaction_policies set revoked_at = null where policy_digest = repeat('a', 64);

insert into public.consents (respondent_id, purpose, granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', false,
    'withdrawn', now() + interval '1 second');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'withdrawal hides report');
select is((select count(*) from research.evidence_quotes), 0::bigint, 'withdrawal hides evidence');
select is(public.read_gate3_qualified_report(
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006'), null::jsonb,
    'reader rechecks withdrawal');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', true,
    'regranted', now() + interval '2 seconds');
update public.respondents set status = 'deleted'
where id = '90500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint, 'respondent deletion hides report');
select is((select count(*) from research.evidence_quotes), 0::bigint, 'respondent deletion hides evidence');
select is(public.read_gate3_qualified_report(
    '90600000-0000-4000-8000-000000000001',
    'a9700000-0000-4000-8000-000000000006'), null::jsonb,
    'reader rechecks respondent deletion');
reset role;
update public.respondents set status = 'active'
where id = '90500000-0000-4000-8000-000000000001';

create temp table previous_source_version as
select redacted_source_version as version from public.transcripts
where id = 'a9700000-0000-4000-8000-000000000005';
update internal.gate1_answer_jobs set publication_policy_digest = repeat('c', 64)
where answer_id = 'a9700000-0000-4000-8000-000000000004';
update public.reports set qualified_policy_digest = repeat('c', 64)
where id = 'a9700000-0000-4000-8000-000000000006';
select isnt((select redacted_source_version from public.transcripts
    where id = 'a9700000-0000-4000-8000-000000000005'),
    (select version from previous_source_version),
    'new qualified receipt rotates source UUID even with identical redacted text');
select is((select redacted_text from public.transcripts
    where id = 'a9700000-0000-4000-8000-000000000005'),
    'A 😀 ordered soup.', 'receipt change leaves redacted text identical');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint,
    'old quote source version cannot cross an identical-text republication');
reset role;
update public.transcripts set redacted_source_version = (select version from previous_source_version)
where id = 'a9700000-0000-4000-8000-000000000005';
select isnt((select redacted_source_version from public.transcripts
    where id = 'a9700000-0000-4000-8000-000000000005'),
    (select version from previous_source_version),
    'direct write cannot restore a prior source UUID');
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'attempted UUID replay cannot reactivate the old quote');
reset role;

update public.transcripts set redacted_text = 'A 😀 ordered rice.'
where id = 'a9700000-0000-4000-8000-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'source revision immediately hides report');
reset role;

update public.transcripts set redacted_text = 'A 😀 ordered soup.'
where id = 'a9700000-0000-4000-8000-000000000005';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint, 'restored text cannot replay an old source version');
reset role;

reset role;
set local role authenticated;
select * from finish();
rollback;
