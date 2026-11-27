begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9900000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Fictional analyst authority', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9900000-0000-4000-8000-000000000001', 1,
    '{"decision":"Which fictional meal should we make?", "hypotheses":["Clarity helps choice"]}',
    '90400000-0000-4000-8000-000000000001');
insert into auth.users (id)
values ('a9700000-0000-4000-8000-000000000009');
insert into public.organizations (id, name)
values ('a9700000-0000-4000-8000-000000000010',
    'Other fictional analyst tenant');
insert into public.researchers (auth_user_id, organization_id,
    terms_version, terms_accepted_at)
values ('a9700000-0000-4000-8000-000000000009',
    'a9700000-0000-4000-8000-000000000010',
    'fictional-v1', now());
insert into public.guide_questions (id, study_id, position, text)
select ('a9910000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', n,
    'Fictional core question ' || n from generate_series(1, 4) as n;
create temp table analyst_quote (id uuid);
grant select, insert on analyst_quote to service_role;
grant select on analyst_quote to authenticated;
set local role service_role;
insert into analyst_quote
select public.freeze_gate2_marketplace_quote(
    'a9900000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":4,"respondentCount":10,"unitPriceCents":200,"amountCents":8000}]',
    8000, 400, '90200000-0000-4000-8000-000000000001');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
values ((select id from analyst_quote),
    'a9900000-0000-4000-8000-000000000001',
    'fixture-analyst-checkout', 'fixture-analyst-created',
    'checkout_created', 8000, 'usd', clock_timestamp());
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
values ((select id from analyst_quote),
    'a9900000-0000-4000-8000-000000000001',
    'fixture-analyst-checkout', 'fixture-analyst-paid', 'paid', 8000, 'usd',
    clock_timestamp());
update public.studies set state = 'fielding'
where id = 'a9900000-0000-4000-8000-000000000001';
insert into internal.gate1_redaction_policies (policy_digest,
    qualification_digest)
values (repeat('a', 64), repeat('b', 64));
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at)
select ('a9920000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001',
    ('90500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'accepted', 400, now() + interval '1 day'
from generate_series(1, 10) as n;
insert into public.sessions (id, invite_id, study_id, state)
select ('a9930000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9920000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', 'in_progress'
from generate_series(1, 10) as n;
insert into public.consents (respondent_id, study_id, purpose,
    granted, text_version)
select ('90500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', purpose,
    true, 'fictional-analysis-v1'
from generate_series(1, 10) as n
cross join unnest(array['retention', 'researcher_access',
    'ai_analysis']) as purpose;
insert into internal.gate3_analysis_consent_receipts (consent_id,
    text_digest)
select id, repeat('c', 64) from public.consents
where study_id = 'a9900000-0000-4000-8000-000000000001'
    and purpose = 'ai_analysis';
insert into public.answers (id, session_id, study_id,
    guide_question_id, kind, sequence)
select ('a9940000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9930000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001',
    'a9910000-0000-4000-8000-000000000001', 'text', 1
from generate_series(1, 10) as n;
insert into public.transcripts (id, answer_id, study_id,
    provider, model, latency_ms, cost_micros)
select ('a9950000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9940000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', 'typed', 'none', 0, 0
from generate_series(1, 10) as n;
insert into pii.transcript_raw (transcript_id, raw_text)
select ('a9950000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'Fictional private answer ' || n from generate_series(1, 10) as n;
insert into internal.gate1_answer_jobs (answer_id)
select id from public.answers
where study_id = 'a9900000-0000-4000-8000-000000000001';

set local role service_role;
do $$
declare n integer; answer_id uuid; lease jsonb; result jsonb;
begin
    for n in 1..10 loop
        answer_id := ('a9940000-0000-4000-8000-' ||
            lpad(to_hex(n), 12, '0'))::uuid;
        lease := public.claim_gate1_answer_job(answer_id);
        if lease ->> 'answerId' is distinct from answer_id::text
        then raise exception 'fictional answer lease missing: %', n; end if;
        result := public.complete_gate1_answer_job(answer_id,
            (lease ->> 'leaseId')::uuid,
            supplied_redacted_text => 'Fictional qualified answer ' || n,
            supplied_redaction_passed => true,
            supplied_policy_digest => repeat('a', 64),
            supplied_qualification_digest => repeat('b', 64));
        if result ->> 'status' is distinct from 'published'
        then raise exception 'fictional answer not published: %', n; end if;
    end loop;
end;
$$;
reset role;

update public.sessions set state = 'submitted',
    submitted_at = clock_timestamp()
where study_id = 'a9900000-0000-4000-8000-000000000001';
insert into public.quality_scores (session_id, score,
    components_json, decision)
select id, 90, '{}'::jsonb, 'approve' from public.sessions
where study_id = 'a9900000-0000-4000-8000-000000000001';
update public.sessions set state = 'approved'
where study_id = 'a9900000-0000-4000-8000-000000000001';

select ok(not has_function_privilege('authenticated',
    'public.read_gate3_analyst_snapshot(uuid,uuid,uuid,text,text,text)',
    'EXECUTE') and not has_function_privilege('authenticated',
    'public.authorize_gate3_analyst_snapshot(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'), 'respondents and researchers cannot read private analyst input');
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'no approved model policy means no analyst source');
reset role;
insert into internal.gate3_analysis_model_policies (
    provider_model, prompt_version, prompt_digest,
    consent_text_version, consent_text_digest, approved_at)
values ('fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fictional-analysis-v1', repeat('c', 64), now() - interval '1 day');
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'ten approved respondents with one of four core answers each are incomplete');
reset role;

-- Complete every frozen core question with a distinct Gate 1 qualified source.
insert into public.answers (id, session_id, study_id,
    guide_question_id, kind, sequence)
select ('a9940000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9930000-0000-4000-8000-' ||
        lpad(to_hex(((n - 11) / 3) + 1), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001',
    ('a9910000-0000-4000-8000-' ||
        lpad(to_hex(((n - 11) % 3) + 2), 12, '0'))::uuid,
    'text', ((n - 11) % 3) + 2
from generate_series(11, 40) as n;
insert into public.transcripts (id, answer_id, study_id,
    provider, model, latency_ms, cost_micros)
select ('a9950000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('a9940000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', 'typed', 'none', 0, 0
from generate_series(11, 40) as n;
insert into pii.transcript_raw (transcript_id, raw_text)
select ('a9950000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'Fictional private answer ' || n from generate_series(11, 40) as n;
insert into internal.gate1_answer_jobs (answer_id)
select id from public.answers
where study_id = 'a9900000-0000-4000-8000-000000000001'
    and id > 'a9940000-0000-4000-8000-00000000000a'::uuid;
set local role service_role;
do $$
declare n integer; answer_id uuid; lease jsonb; result jsonb;
begin
    for n in 11..40 loop
        answer_id := ('a9940000-0000-4000-8000-' ||
            lpad(to_hex(n), 12, '0'))::uuid;
        lease := public.claim_gate1_answer_job(answer_id);
        if lease ->> 'answerId' is distinct from answer_id::text
        then raise exception 'complete core lease missing: %', n; end if;
        result := public.complete_gate1_answer_job(answer_id,
            (lease ->> 'leaseId')::uuid,
            supplied_redacted_text => 'Fictional qualified answer ' || n,
            supplied_redaction_passed => true,
            supplied_policy_digest => repeat('a', 64),
            supplied_qualification_digest => repeat('b', 64));
        if result ->> 'status' is distinct from 'published'
        then raise exception 'complete core source not published: %', n; end if;
    end loop;
end;
$$;
reset role;
create temp table analyst_candidate_digest as
select encode(pg_catalog.sha256(convert_to(
    public.read_gate3_analyst_candidate_snapshot(
        'a9900000-0000-4000-8000-000000000001',
        (select id from analyst_quote),
        '90200000-0000-4000-8000-000000000001',
        'fixture-model', 'fixture-prompt-v1', repeat('d', 64))::text,
    'UTF8')), 'hex') as value;
grant select on analyst_candidate_digest to authenticated;

set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'qualified cohort is withheld until independent AAL2 review');
reset role;

select ok(not has_function_privilege('service_role',
    'public.attest_gate3_analyst_snapshot(uuid,uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'), 'service role cannot self-attest analyst sources');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is(public.attest_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'a9990000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select value from analyst_candidate_digest)), null::uuid,
    'AAL1 researcher cannot attest private analyst source set');
reset role;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
set local role authenticated;
select is(public.attest_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    'a9700000-0000-4000-8000-000000000009',
    'a9990000-0000-4000-8000-000000000002',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select value from analyst_candidate_digest)), null::uuid,
    'actor cannot attest as a different researcher');
select is(public.attest_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'a9990000-0000-4000-8000-000000000004',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    repeat('f', 64)), null::uuid,
    'reviewer cannot attest a different source digest');
select ok(public.attest_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'a9990000-0000-4000-8000-000000000003',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select value from analyst_candidate_digest)) is not null,
    'AAL2 same-tenant researcher separately attests exact source set');
reset role;
reset request.jwt.claims;

create temp table analyst_snapshot as
select public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)) as payload;
grant select on analyst_snapshot to service_role;
grant select on analyst_snapshot to gate3_analysis_validator;
create temp table analyst_binding as
select internal.gate3_analysis_binding_projection(payload)::text as key,
    encode(pg_catalog.sha256(convert_to(
        internal.gate3_analysis_binding_projection(payload)::text,
        'UTF8')), 'hex') as digest
from analyst_snapshot;
grant select on analyst_binding to service_role;
grant select on analyst_binding to gate3_analysis_validator;
create temp table analyst_binding_variants as
with altered as (
    select 'quote'::text as variant,
        jsonb_set(key::jsonb, '{quoteId}',
            to_jsonb('a9990000-0000-4000-8000-000000000009'::text))::text
            as key from analyst_binding
    union all
    select 'membership'::text,
        jsonb_set(key::jsonb,
            '{approvedSessions,0,respondentId}',
            to_jsonb('a9990000-0000-4000-8000-000000000010'::text))::text
        from analyst_binding
)
select variant, key,
    encode(pg_catalog.sha256(convert_to(key, 'UTF8')), 'hex') as digest
from altered;
grant select on analyst_binding_variants to service_role;
create temp table analyst_output_receipt (id uuid);
grant select, insert on analyst_output_receipt to gate3_analysis_validator;
grant select on analyst_output_receipt to service_role;
grant gate3_analysis_validator to postgres;
set local role gate3_analysis_validator;
insert into analyst_output_receipt
select public.attest_gate3_private_analysis_output(
    'a9900000-0000-4000-8000-000000000001',
    (select (payload ->> 'reviewerReceiptId')::uuid from analyst_snapshot),
    (select digest from analyst_binding),
    '{"privateDraft":"fictional"}',
    '{"privateScreened":"fictional"}');
reset role;
revoke gate3_analysis_validator from postgres;
select isnt((select draft_digest from internal.gate3_analysis_output_receipts
    where id = (select id from analyst_output_receipt)),
    encode(pg_catalog.sha256(convert_to(
        '{"privateDraft":"fictional"}'::jsonb::text, 'UTF8')), 'hex'),
    'output receipt hashes exact supplied JSON bytes, not JSONB reserialization');
select is(jsonb_array_length((select payload from analyst_snapshot)
    -> 'sources'), 40, 'ten complete fictional respondents supply forty qualified core answers');
select is(jsonb_array_length((select payload from analyst_snapshot)
    -> 'approvedSessions'), 10,
    'private snapshot carries exact approved respondent/session membership');
select is((select payload ->> 'guideDigest' from analyst_snapshot),
    (select guide_digest from public.gate2_quote_snapshots
        where id = (select id from analyst_quote)),
    'private snapshot carries frozen quote guide digest');
select is((select payload -> 'sources' -> 0 -> 'receipt'
    ->> 'redactedTextDigest' from analyst_snapshot),
    (select encode(pg_catalog.sha256(convert_to(
        payload -> 'sources' -> 0 ->> 'redactedText', 'UTF8')), 'hex')
        from analyst_snapshot),
    'each qualified source carries matching exact text receipt');
select is(jsonb_array_length((select payload from analyst_snapshot)
    -> 'guideQuestions'), 4, 'frozen four-question guide is included');
select ok((select payload from analyst_snapshot) ?& array[
    'sourceSetVersion', 'consentRevision', 'reviewerReceiptId',
    'briefVersion', 'pricingConfigVersion', 'quoteId'],
    'private snapshot carries full reviewed source and frozen price identities');
set local role service_role;
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot)), true,
    'same frozen source and purpose authorize the model boundary');
select ok(not has_table_privilege('service_role',
    'pii.gate3_private_analysis_proposals', 'SELECT')
    and not has_function_privilege('service_role',
    'public.attest_gate3_private_analysis_output(uuid,uuid,text,text,text)',
    'EXECUTE')
    and not has_function_privilege('authenticated',
    'public.write_gate3_private_analysis_proposal(uuid,uuid,uuid,text,text,text,text,text,text,jsonb,text,text,jsonb,jsonb,text,text,uuid,uuid)',
    'EXECUTE'), 'private proposals have no direct service or client read');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), (select digest from analyst_binding),
    '{"privateDraft":"fictional"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"fictional"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000005'), true,
    'first private proposal stores against current reviewed snapshot');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), repeat('f', 64),
    '{"privateDraft":"fictional"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"fictional"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000008'), false,
    'caller-supplied digest cannot differ from the current binding key');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding_variants where variant = 'quote'),
    (select digest from analyst_binding_variants where variant = 'quote'),
    '{"privateDraft":"fictional"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"fictional"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000011'), false,
    'quote-only binding change cannot certify current proposal');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding_variants where variant = 'membership'),
    (select digest from analyst_binding_variants where variant = 'membership'),
    '{"privateDraft":"fictional"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"fictional"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000012'), false,
    'reviewed cohort membership-only change cannot certify proposal');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), (select digest from analyst_binding),
    '{"privateDraft":"fictional"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"fictional"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000005'), true,
    'same private proposal replay returns prior result');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), (select digest from analyst_binding),
    '{"privateDraft":"changed"}'::jsonb,
    '{"privateScreened":"fictional"}'::jsonb,
    '{"privateDraft":"changed"}', '{"privateScreened":"fictional"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000005'), false,
    'replayed causation cannot replace the first private proposal');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), (select digest from analyst_binding),
    '{"privateDraft":"second worker"}'::jsonb,
    '{"privateScreened":"second worker"}'::jsonb,
    '{"privateDraft":"second worker"}', '{"privateScreened":"second worker"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000007'), false,
    'second worker cannot store another proposal for same reviewed source');
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select jsonb_set(payload, '{consentRevision}',
        to_jsonb('a9990000-0000-4000-8000-000000000009'::text))
        from analyst_snapshot)), false,
    'changed consent revision denies authorization');
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select jsonb_set(payload, '{pricingConfigVersion}', '102'::jsonb)
        from analyst_snapshot)), false,
    'changed frozen price version denies authorization');
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    'a9700000-0000-4000-8000-000000000009',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'unbound researcher cannot request private source');
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'other-prompt', repeat('d', 64)), null::jsonb,
    'unapproved prompt cannot read model input');
reset role;

savepoint changed_analyst_membership;
update public.respondents set status = 'paused'
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'approved cohort membership change withholds analyst source');
reset role;
rollback to savepoint changed_analyst_membership;

savepoint former_analyst_reviewer;
update public.researchers set organization_id =
    'a9700000-0000-4000-8000-000000000010'
where auth_user_id = '90200000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000002',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'former-tenant reviewer cannot keep an old source attestation current');
reset role;
rollback to savepoint former_analyst_reviewer;

savepoint stale_analysis_source;
update public.transcripts set redacted_text = 'Changed without qualification'
where id = 'a9950000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot)), false,
    'edited redacted text lacks exact publication receipt');
select is(public.write_gate3_private_analysis_proposal(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot),
    (select key from analyst_binding), (select digest from analyst_binding),
    '{"privateDraft":"stale"}'::jsonb,
    '{"privateScreened":"stale"}'::jsonb,
    '{"privateDraft":"stale"}', '{"privateScreened":"stale"}',
    (select id from analyst_output_receipt),
    'a9990000-0000-4000-8000-000000000006'), false,
    'changed source cannot enter private proposal sink');
reset role;
rollback to savepoint stale_analysis_source;
savepoint stale_analysis_guide;
update public.guide_questions set text = 'Changed after quote'
where id = 'a9910000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'guide changed after quote withholds analysis');
reset role;
rollback to savepoint stale_analysis_guide;

insert into public.consents (respondent_id, study_id, purpose,
    granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001',
    'ai_analysis', false, 'fictional-analysis-v1',
    now() + interval '1 second');
set local role service_role;
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot)), false,
    'revoked analysis purpose rejects captured private source');
reset role;
insert into public.consents (respondent_id, study_id, purpose,
    granted, text_version, created_at)
values ('90500000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000001',
    'ai_analysis', true, 'fictional-analysis-v1',
    now() + interval '2 seconds');
insert into internal.gate3_analysis_consent_receipts (consent_id, text_digest)
select id, repeat('c', 64) from public.consents
where respondent_id = '90500000-0000-4000-8000-000000000001'
    and study_id = 'a9900000-0000-4000-8000-000000000001'
    and purpose = 'ai_analysis' and granted
    order by created_at desc, recorded_sequence desc limit 1;
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    (select id from analyst_quote),
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'same-text regrant cannot revive an old captured source');
reset role;

select * from finish();
rollback;
