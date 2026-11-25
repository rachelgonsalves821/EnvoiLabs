begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes)
values ('a9850000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic refund settlement', 'awaiting_payment', 10, 10);
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9850000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select 'a9850000-0000-4000-8000-000000000001', n,
    'Synthetic refund question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9850000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'frozen quote supplies the original unfilled-slot price');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_refund_settlement',
    'checkout-created:refund-settlement', 'checkout_created',
    total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9850000-0000-4000-8000-000000000001';
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_refund_settlement',
    'paid:refund-settlement', 'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9850000-0000-4000-8000-000000000001';
update public.studies set state = 'closed'
where id = 'a9850000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.reserve_gate2_unfilled_slot_refund(
    'a9850000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') is not null,
    'closed unfilled study has one immutable refund reservation');
reset role;
select ok(not has_function_privilege('authenticated',
    'public.claim_gate2_refund_intent(uuid,uuid)', 'EXECUTE'),
    'clients cannot request provider refunds');
select ok(not has_table_privilege('service_role',
    'internal.gate2_refund_events', 'INSERT'),
    'service cannot insert a settlement event directly');
set local role service_role;
select throws_ok($$select public.claim_gate2_refund_intent(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90300000-0000-4000-8000-000000000001')$$,
    '23514', null, 'wrong principal cannot claim a refund');
select is(public.claim_gate2_refund_intent(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'status',
    'create', 'one provider create lease is claimed before network use');
select is(public.claim_gate2_refund_intent(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'status',
    'unavailable', 'an uncertain immediate replay makes no second request');
reset role;
update internal.gate2_refund_intents
set first_attempt_at = clock_timestamp() - interval '24 hours',
    lease_expires_at = clock_timestamp() - interval '1 hour';
set local role service_role;
select is(public.claim_gate2_refund_intent(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'status',
    'unavailable', 'a no-ID uncertain result cannot create after key retention');
select ok(not public.record_gate2_refund_observation(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    're_test_refund_1', 'pending', 900, clock_timestamp()),
    'provider observation cannot change the frozen refund amount');
select ok(public.record_gate2_refund_observation(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    're_test_refund_1', 'pending', 10000, clock_timestamp()),
    'known pending provider refund is recorded once');
select is(public.claim_gate2_refund_intent(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'refundId',
    're_test_refund_1', 'known refund is retrieved instead of created again');
select ok(not public.record_gate2_refund_observation(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    're_test_other', 'succeeded', 10000, clock_timestamp()),
    'a different provider refund cannot replace the known identity');
select ok(public.record_gate2_refund_observation(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    're_test_refund_1', 'succeeded', 10000, clock_timestamp()),
    'observed provider success settles the reserved amount');
select ok(not public.record_gate2_refund_observation(
    (select id from public.gate2_refund_reservations
        where study_id = 'a9850000-0000-4000-8000-000000000001'),
    're_test_refund_1', 'failed', 10000, clock_timestamp()),
    'a terminal succeeded refund cannot reverse to failure');
reset role;
select is((select attempts from internal.gate2_refund_intents), 1,
    'a known provider refund retains the original one-attempt intent');
select * from finish();
rollback;
