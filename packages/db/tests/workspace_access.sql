begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, research;
select no_plan();

-- Test deny-by-default grants and RLS for the complete application table inventory.
select is(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname in ('public', 'pii')),
    33::bigint, 'The full Gate 0 table inventory exists'
);

select ok(
    c.relrowsecurity
        and not has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        and not has_any_column_privilege('authenticated', c.oid, 'INSERT, UPDATE, REFERENCES')
        and not has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER')
        and not has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER')
        and has_table_privilege('service_role', c.oid, 'SELECT')
        and (n.nspname <> 'pii' or not has_any_column_privilege('authenticated', c.oid, 'SELECT')),
    format('%I.%I has RLS, service access and deny-by-default client grants', n.nspname, c.relname)
)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'pii')
order by n.nspname, c.relname;

insert into auth.users (id) values ('90000000-0000-4000-8000-000000000001');
insert into public.organizations (id, name) values ('90000000-0000-4000-8000-000000000002', 'Other organization');
insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
values ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'fixture-1', now());
insert into public.studies (id, organization_id, title, target_completes, length_minutes)
values ('90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000002', 'Other study', 20, 15);

insert into public.guide_questions (id, study_id, position, text) values
    ('91000000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001', 1, 'What did you order?'),
    ('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', 1, 'Other question');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at) values
    ('91100000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
        '90500000-0000-4000-8000-000000000001', 'accepted', 300, now() + interval '1 day'),
    ('91100000-0000-4000-8000-000000000002', '90600000-0000-4000-8000-000000000001',
        '90500000-0000-4000-8000-000000000002', 'invited', 300, now() + interval '1 day');
insert into public.sessions (id, study_id, invite_id)
values ('91200000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001');
insert into public.answers (id, study_id, session_id, guide_question_id, kind, sequence)
values ('91300000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    '91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, redacted_text, provider, model, latency_ms, cost_micros)
values ('91400000-0000-4000-8000-000000000001', '91300000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'I ordered soup.', 'fixture', 'fixture', 1, 0);
insert into pii.transcript_raw (transcript_id, raw_text)
values ('91400000-0000-4000-8000-000000000001', 'Synthetic private text destination fixture.');
insert into public.reports (id, study_id, version, state, summary_json)
values ('91500000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    1, 'ready', '{}');
insert into public.findings (id, report_id, study_id, position, claim, count, total, confidence)
values ('91600000-0000-4000-8000-000000000001', '91500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1, 'One respondent ordered food.', 1, 1, 'high');
insert into public.evidence_quotes (finding_id, transcript_id, study_id, start_char, end_char, text)
values ('91600000-0000-4000-8000-000000000001', '91400000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 2, 9, 'Stored fixture text differs');

select throws_ok(
    $$insert into public.answers (study_id, session_id, guide_question_id, kind, sequence)
      values ('90600000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001',
          '91000000-0000-4000-8000-000000000002', 'text', 2)$$,
    '23503', null, 'An answer cannot link to a guide question from another study'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from profile_attributes), 6::bigint, 'Respondent sees own profile only');
select is((select count(id) from public.invites), 1::bigint, 'Respondent sees own invite only');
select is((select count(id) from public.sessions), 1::bigint, 'Respondent sees own session');
select is((select count(*) from public.guide_questions), 1::bigint, 'Accepted invite grants access to its guide only');
select is((select count(*) from research.studies), 0::bigint, 'Respondent cannot read researcher studies');
select throws_ok($$select raw_text from pii.transcript_raw$$, '42501', null, 'Respondent cannot directly read raw transcripts');

set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(id) from public.sessions), 0::bigint, 'Another respondent cannot see the session');
select is((select count(*) from public.guide_questions), 0::bigint, 'Unaccepted invite grants no guide access');

set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from research.studies), 0::bigint, 'Research access requires MFA even for the tenant admin');

set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select title from research.studies), 'Late-night food choices fixture', 'MFA admin sees only their own tenant study');
select is((select count(*) from public.profile_attributes), 0::bigint, 'MFA admin cannot browse respondent profiles');
select is((select count(*) from research.transcripts), 0::bigint, 'Missing consent denies transcript access');
select is((select count(*) from research.evidence_quotes), 0::bigint, 'Missing consent denies evidence access');
select throws_ok($$select raw_text from pii.transcript_raw$$, '42501', null, 'MFA admin cannot read raw transcripts');
select throws_ok($$select provider from public.transcripts$$, '42501', null, 'MFA admin cannot read transcript provider data');

reset role;
insert into public.consents (respondent_id, purpose, granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', true, 'fixture-1', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is((select redacted_text from research.transcripts), 'I ordered soup.', 'Consented text is available to the MFA tenant researcher');
select is((select text from research.evidence_quotes), 'ordered', 'Evidence is read from the consented redacted transcript');
select throws_ok($$select text from public.evidence_quotes$$, '42501', null, 'Stored quote text is private to the server');

set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select title from research.studies), 'Other study', 'Another tenant sees its own study only');
select is((select count(*) from research.transcripts), 0::bigint, 'Consent grants no cross-tenant access');

reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
    'researcher_access', false, 'fixture-1', now() + interval '1 second');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.transcripts), 0::bigint, 'Study withdrawal overrides the general grant');

reset role;
insert into public.consents (respondent_id, study_id, purpose, granted, text_version, created_at)
values
    ('90500000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
        'researcher_access', true, 'fixture-1', now() + interval '2 seconds'),
    ('90500000-0000-4000-8000-000000000001', null,
        'researcher_access', false, 'fixture-1', now() + interval '3 seconds');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.transcripts), 0::bigint, 'General withdrawal overrides the current study grant');

set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$select id from research.studies$$, '42501', null, 'Anonymous clients cannot read research views');

set local role service_role;
select is((select count(*) from pii.transcript_raw), 1::bigint, 'Trusted service can read private transcript storage');

reset role;
select * from finish();
rollback;
