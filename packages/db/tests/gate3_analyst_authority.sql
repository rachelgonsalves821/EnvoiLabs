begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes)
values ('a9900000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Fictional analyst authority', 'fielding', 10, 10);
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9900000-0000-4000-8000-000000000001', 1,
    '{"decision":"Which fictional meal should we make?", "hypotheses":["Clarity helps choice"]}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (id, study_id, position, text)
select ('a9910000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'a9900000-0000-4000-8000-000000000001', n,
    'Fictional core question ' || n from generate_series(1, 4) as n;
insert into public.gate2_quote_snapshots (id, study_id, brief_version,
    guide_digest, pricing_config_id, pricing_config_version,
    line_items_json, total_cents, incentive_cents_per_complete,
    feasibility_json)
select 'a9900000-0000-4000-8000-000000000002',
    'a9900000-0000-4000-8000-000000000001', 1,
    public.gate2_guide_digest('a9900000-0000-4000-8000-000000000001'),
    config.id, 101, '[{"respondentCount":10}]', 8000, 400,
    '{"fictional":true}' from public.pricing_configs as config
    where config.version = 101;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents, currency)
values ('a9900000-0000-4000-8000-000000000002',
    'a9900000-0000-4000-8000-000000000001',
    'fixture-analyst-checkout', 'fixture-analyst-paid', 'paid', 8000, 'usd');
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
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'no approved model policy means no analyst source');
reset role;
insert into internal.gate3_analysis_model_policies (
    provider_model, prompt_version, prompt_digest,
    consent_text_version, consent_text_digest, approved_at)
values ('fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    'fictional-analysis-v1', repeat('c', 64), now() - interval '1 day');

create temp table analyst_snapshot as
select public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)) as payload;
grant select on analyst_snapshot to service_role;
select is(jsonb_array_length((select payload from analyst_snapshot)
    -> 'sources'), 10, 'ten qualified fictional respondents enter snapshot');
select is(jsonb_array_length((select payload from analyst_snapshot)
    -> 'guideQuestions'), 4, 'frozen four-question guide is included');
set local role service_role;
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot)), true,
    'same frozen source and purpose authorize the model boundary');
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000002',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'unbound researcher cannot request private source');
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'other-prompt', repeat('d', 64)), null::jsonb,
    'unapproved prompt cannot read model input');
reset role;

savepoint stale_analysis_source;
update public.transcripts set redacted_text = 'Changed without qualification'
where id = 'a9950000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.authorize_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64),
    (select payload from analyst_snapshot)), false,
    'edited redacted text lacks exact publication receipt');
reset role;
rollback to savepoint stale_analysis_source;
savepoint stale_analysis_guide;
update public.guide_questions set text = 'Changed after quote'
where id = 'a9910000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.read_gate3_analyst_snapshot(
    'a9900000-0000-4000-8000-000000000001',
    'a9900000-0000-4000-8000-000000000002',
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
    'a9900000-0000-4000-8000-000000000002',
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
    'a9900000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    'fixture-model', 'fixture-prompt-v1', repeat('d', 64)), null::jsonb,
    'same-text regrant cannot revive an old captured source');
reset role;

select * from finish();
rollback;
