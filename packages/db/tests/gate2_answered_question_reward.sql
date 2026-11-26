begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9860000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic answered reward', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9860000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (id, study_id, position, text)
select format('a9860000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'a9860000-0000-4000-8000-000000000001', n,
    'Core question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9860000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'marketplace payout derives from a frozen quote');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_reward', 'paid:answered-reward',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9860000-0000-4000-8000-000000000001';
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9860000-0000-4000-8000-000000000002',
    'a9860000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 500,
    clock_timestamp() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
values ('a9860000-0000-4000-8000-000000000003',
    'a9860000-0000-4000-8000-000000000002',
    'a9860000-0000-4000-8000-000000000001', 'quality_hold',
    now() - interval '2 days 1 hour', now() - interval '2 days');
insert into public.quality_scores (session_id, score, components_json,
    decision, decided_by) values (
    'a9860000-0000-4000-8000-000000000003', 80, '{}'::jsonb,
    'approve', '90400000-0000-4000-8000-000000000001');
update public.sessions set state = 'approved'
where id = 'a9860000-0000-4000-8000-000000000003';
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence)
select format('a9860000-0000-4000-8000-%s', lpad((n + 20)::text, 12, '0'))::uuid,
    'a9860000-0000-4000-8000-000000000003',
    'a9860000-0000-4000-8000-000000000001',
    format('a9860000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'text', n from generate_series(1, 3) as n;
insert into public.transcripts (answer_id, study_id, provider, model,
    latency_ms, cost_micros)
select id, study_id, 'respondent', 'typed', 0, 0 from public.answers
where session_id = 'a9860000-0000-4000-8000-000000000003';
insert into pii.transcript_raw (transcript_id, raw_text)
select id, 'Meaningful answer' from public.transcripts
where study_id = 'a9860000-0000-4000-8000-000000000001';
insert into public.answers (id, session_id, study_id, guide_question_id,
    kind, sequence)
values ('a9860000-0000-4000-8000-000000000024',
    'a9860000-0000-4000-8000-000000000003',
    'a9860000-0000-4000-8000-000000000001',
    'a9860000-0000-4000-8000-000000000011', 'text', 4),
    ('a9860000-0000-4000-8000-000000000025',
    'a9860000-0000-4000-8000-000000000003',
    'a9860000-0000-4000-8000-000000000001',
    'a9860000-0000-4000-8000-000000000014', 'text', 5);
insert into public.transcripts (answer_id, study_id, provider, model,
    latency_ms, cost_micros)
select id, study_id, 'respondent', 'typed', 0, 0 from public.answers
where id in ('a9860000-0000-4000-8000-000000000024',
    'a9860000-0000-4000-8000-000000000025');
insert into pii.transcript_raw (transcript_id, raw_text)
select id, case when answer_id = 'a9860000-0000-4000-8000-000000000025'
    then '   ' else 'Revised answer' end
from public.transcripts where answer_id in
    ('a9860000-0000-4000-8000-000000000024',
    'a9860000-0000-4000-8000-000000000025');
select ok(not has_function_privilege('anon',
    'public.read_gate2_current_respondent_earnings()', 'EXECUTE'),
    'anonymous clients cannot read respondent earnings');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.read_gate2_current_respondent_earnings()
    ->> 'earnedCents')::integer, 300,
    'approved substantive core answers appear before payout reservation');
select is(public.read_gate2_current_respondent_earnings()
    -> 'sessions' -> 0 ->> 'payoutStatus', 'awaiting_reservation',
    'earned amount is not mislabeled delivered before reservation');
select ok(public.read_gate2_current_respondent_earnings()::text
    not like '%Meaningful answer%', 'earnings never exposes answer text');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.read_gate2_current_respondent_earnings()
    ->> 'earnedCents')::integer, 0,
    'another respondent cannot read this earned balance');
reset role;
set local role service_role;
select throws_ok($$select public.reserve_gate2_session_payout(
    'a9860000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 500, 200000,
    'payout:a9860000-0000-4000-8000-000000000003')$$,
    '23514', null, 'three answered core questions cannot claim the full five-question reward');
select ok(public.reserve_gate2_session_payout(
    'a9860000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 300, 200000,
    'payout:a9860000-0000-4000-8000-000000000003') is not null,
    'three approved recorded core answers reserve exactly $3');
select is(public.reserve_gate2_session_payout(
    'a9860000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 300, 200000,
    'payout:a9860000-0000-4000-8000-000000000003'),
    (select id from public.payouts where session_id =
        'a9860000-0000-4000-8000-000000000003'),
    'same approved amount retries as one reservation');
reset role;
select is((select amount_cents from public.payouts where session_id =
    'a9860000-0000-4000-8000-000000000003'), 300,
    'stored payout preserves the earned answer amount');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_current_respondent_earnings()
    -> 'sessions' -> 0 ->> 'payoutStatus', 'pending',
    'current earnings read distinguishes reserved from delivered payout');
reset role;
update public.respondents set status = 'deleted'
where id = '90500000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_current_respondent_earnings(), null::jsonb,
    'deleted respondent no longer has an earnings read');
reset role;
select * from finish();
rollback;
