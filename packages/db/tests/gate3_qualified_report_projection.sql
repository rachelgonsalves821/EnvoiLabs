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

insert into public.reports (id, study_id, version, state, summary_json)
values ('a9700000-0000-4000-8000-000000000006', '90600000-0000-4000-8000-000000000001',
    1, 'ready', '{"raw":"private model summary"}');
insert into public.findings (id, report_id, study_id, position, claim, count, total, confidence)
values ('a9700000-0000-4000-8000-000000000007', 'a9700000-0000-4000-8000-000000000006',
    '90600000-0000-4000-8000-000000000001', 1, 'Private model claim', 1, 1, 'high');
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

set local role service_role;
select throws_ok($$update public.reports set qualified_summary_json = '{"raw":"Ada Example"}'
    where id = 'a9700000-0000-4000-8000-000000000006'$$,
    '42501', null, 'service cannot directly write a qualified summary');
select throws_ok($$update public.findings set qualified_claim = 'Ada Example'
    where id = 'a9700000-0000-4000-8000-000000000007'$$,
    '42501', null, 'service cannot directly write a qualified claim');
select ok(public.publish_gate3_qualified_report(
    'a9700000-0000-4000-8000-000000000006',
    '{"version":2,"executiveAnswer":"One soup order","hypotheses":[],"themes":[]}',
    '{"a9700000-0000-4000-8000-000000000007":"One respondent ordered soup"}',
    repeat('a', 64), repeat('b', 64)), 'trusted publisher binds exact qualified output');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 1::bigint, 'qualified report is visible to MFA tenant researcher');
select is((select claim from research.findings), 'One respondent ordered soup', 'only qualified claim is projected');
select is((select text from research.evidence_quotes), 'ordered soup', 'exact Unicode codepoint span is projected');
reset role;
update public.reports set qualified_summary_json = '{"raw":"Ada Example"}'
where id = 'a9700000-0000-4000-8000-000000000006';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint,
    'privileged post-publication text mutation invalidates its receipt');
reset role;
update public.reports set qualified_summary_json =
    '{"version":2,"executiveAnswer":"One soup order","hypotheses":[],"themes":[]}'
where id = 'a9700000-0000-4000-8000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from research.reports), 0::bigint, 'pre-MFA researcher sees no report');
set local request.jwt.claims = '{"sub":"a9700000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'other tenant sees no report');
reset role;

insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('c', 64), repeat('b', 64));
update public.reports set qualified_policy_digest = repeat('c', 64)
where id = 'a9700000-0000-4000-8000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'report receipt must match each cited source');
reset role;
update public.reports set qualified_policy_digest = repeat('a', 64)
where id = 'a9700000-0000-4000-8000-000000000006';

update public.evidence_quotes set text = 'not the source'
where id = 'a9700000-0000-4000-8000-000000000008';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.reports), 0::bigint, 'mismatched quote text hides report');
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
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', true,
    'regranted', now() + interval '2 seconds');
update public.respondents set status = 'deleted'
where id = '90500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from research.reports), 0::bigint, 'respondent deletion hides report');
select is((select count(*) from research.evidence_quotes), 0::bigint, 'respondent deletion hides evidence');
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

select * from finish();
rollback;
