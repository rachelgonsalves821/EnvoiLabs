begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9870000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic push timing', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '1 day');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9870000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (id, study_id, position, text)
select format('a9870000-0000-4000-8000-%s', lpad((n + 10)::text, 12, '0'))::uuid,
    'a9870000-0000-4000-8000-000000000001', n,
    'Push question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9870000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'push test uses a paid frozen marketplace quote');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_push', 'paid:push',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9870000-0000-4000-8000-000000000001';
update public.studies set state = 'fielding'
where id = 'a9870000-0000-4000-8000-000000000001';
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at)
values ('a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 500,
    clock_timestamp() + interval '4 hours');
insert into public.sessions (id, invite_id, study_id, state, started_at)
values ('a9870000-0000-4000-8000-000000000003',
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000001', 'in_progress',
    clock_timestamp() - interval '3 hours');
insert into public.answers (session_id, study_id, guide_question_id,
    kind, sequence, created_at)
select 'a9870000-0000-4000-8000-000000000003',
    'a9870000-0000-4000-8000-000000000001', question.id,
    'text', question.position, clock_timestamp() - interval '2 hours 1 minute'
from public.guide_questions as question
where question.study_id = 'a9870000-0000-4000-8000-000000000001'
    and question.position <= 3;
insert into public.push_subscriptions (respondent_id, endpoint, keys_json, platform)
values ('90500000-0000-4000-8000-000000000001',
    'https://push.example.invalid/synthetic', '{}'::jsonb, 'web');
select ok(not has_function_privilege('authenticated',
    'public.list_gate2_nudge_candidates()', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.queue_gate2_nudge(uuid,uuid,text,text)', 'EXECUTE'),
    'respondents cannot inspect or enqueue the private push outbox');
set local role service_role;
select is(jsonb_array_length(public.list_gate2_nudge_candidates()), 0,
    'browser subscription alone does not grant push purpose consent');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', true, 'synthetic-push-only');
set local role service_role;
select is(jsonb_array_length(public.list_gate2_nudge_candidates()), 1,
    'current opt-in and subscription expose one private due candidate');
select ok(public.queue_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000003',
    'halfway', 'gate2-nudge:a9870000-0000-4000-8000-000000000002:halfway'),
    'quiet halfway respondent gets one queued reminder');
select ok(not public.queue_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000003',
    'halfway', 'gate2-nudge:a9870000-0000-4000-8000-000000000002:halfway'),
    'same reminder key replay creates no second row');
select is(public.list_gate2_nudge_candidates() -> 0 -> 'sentKinds',
    '["halfway"]'::jsonb, 'queued reminder suppresses another due selection');
reset role;
update internal.gate2_nudge_outbox
set id = 'a9870000-0000-4000-8000-000000000020'
where kind = 'halfway';
set local role service_role;
select ok(not has_function_privilege('authenticated',
    'public.claim_gate2_nudge_delivery(uuid,uuid)', 'EXECUTE'),
    'respondents cannot claim private delivery material');
select is(jsonb_array_length(public.list_gate2_nudge_dispatchable()), 1,
    'one queued outbox needs private delivery preparation');
select is(jsonb_array_length(public.prepare_gate2_nudge_deliveries(
    (public.list_gate2_nudge_dispatchable() ->> 0)::uuid)), 1,
    'one current subscription gets one private delivery row');
reset role;
update internal.gate2_nudge_deliveries
set id = 'a9870000-0000-4000-8000-000000000021';
set local role service_role;
select is(public.claim_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010') ->> 'endpoint',
    'https://push.example.invalid/synthetic',
    'claim returns only the current private subscription endpoint');
select is(public.claim_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010'), null::jsonb,
    'an uncertain send cannot claim again with the same key');
select ok(not public.observe_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000011', 'sent'),
    'a different worker cannot settle the claim');
select ok(public.observe_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010', 'sent'),
    'the owning claim records one observed send');
select ok(public.observe_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010', 'sent'),
    'an exact observation replay is idempotent');
select ok(not public.observe_gate2_nudge_delivery(
    'a9870000-0000-4000-8000-000000000021',
    'a9870000-0000-4000-8000-000000000010', 'failed'),
    'a terminal sent result cannot be reversed');
select is(jsonb_array_length(public.list_gate2_nudge_dispatchable()), 0,
    'the settled outbox is not dispatched again');
reset role;
delete from public.push_subscriptions
where endpoint = 'https://push.example.invalid/synthetic';
insert into public.push_subscriptions (respondent_id, endpoint, keys_json, platform)
values ('90500000-0000-4000-8000-000000000001',
    'https://push.example.invalid/synthetic', '{}'::jsonb, 'web');
set local role service_role;
select is(jsonb_array_length(public.prepare_gate2_nudge_deliveries(
    'a9870000-0000-4000-8000-000000000020')), 0,
    'removing and re-registering one endpoint cannot resend a settled nudge');
reset role;
select is((select count(*)::integer from internal.gate2_nudge_outbox), 1,
    'private outbox contains one reminder and no delivery');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.snooze_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002'), null::timestamptz,
    'another respondent cannot snooze this offer');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(public.snooze_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002') > clock_timestamp(),
    'owner snoozes the in-progress offer for three hours');
reset role;
update public.invites set expires_at = clock_timestamp() + interval '1 hour'
where id = 'a9870000-0000-4000-8000-000000000002';
set local role service_role;
select ok(not public.queue_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000003',
    'two_hours_left',
    'gate2-nudge:a9870000-0000-4000-8000-000000000002:two_hours_left'),
    'snoozed respondent gets no deadline reminder');
reset role;
update internal.gate2_nudge_snoozes set until_at = clock_timestamp() - interval '1 minute';
set local role service_role;
select ok(public.queue_gate2_nudge(
    'a9870000-0000-4000-8000-000000000002',
    'a9870000-0000-4000-8000-000000000003',
    'two_hours_left',
    'gate2-nudge:a9870000-0000-4000-8000-000000000002:two_hours_left'),
    'deadline reminder queues after snooze ends');
reset role;
update internal.gate2_nudge_outbox
set id = 'a9870000-0000-4000-8000-000000000022'
where kind = 'two_hours_left';
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', false, 'synthetic-push-revoked');
set local role service_role;
select is(jsonb_array_length(public.list_gate2_nudge_candidates()), 0,
    'revoked push consent removes candidate from current read');
select is(jsonb_array_length(public.prepare_gate2_nudge_deliveries(
    'a9870000-0000-4000-8000-000000000022'), 0,
    'queued deadline reminder cannot prepare delivery after revocation');
reset role;
select is((select count(*)::integer from internal.gate2_nudge_outbox), 2,
    'only one halfway and one deadline reminder were queued');
select * from finish();
rollback;
