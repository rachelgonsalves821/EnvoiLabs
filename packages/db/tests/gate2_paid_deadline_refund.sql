begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9f40000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Paid deadline fixture', 'awaiting_payment', 12, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9f40000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select 'a9f40000-0000-4000-8000-000000000001', n,
    'Synthetic deadline question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9f40000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":12,"unitPriceCents":200,"amountCents":12000}]',
    12000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'quote freezes twelve slots at five core questions and $2 each');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_deadline_1', 'evt_deadline_created',
    'checkout_created', total_cents, currency, now()
from public.gate2_quote_snapshots
where study_id = 'a9f40000-0000-4000-8000-000000000001';
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_deadline_1', 'evt_deadline_paid',
    'paid', total_cents, currency, now()
from public.gate2_quote_snapshots
where study_id = 'a9f40000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('authenticated',
    'public.expire_gate2_paid_after_deadline(uuid,uuid,text)', 'EXECUTE'),
    'clients cannot make a paid expiry or refund reservation');
set local role service_role;
select is(public.expire_gate2_paid_after_deadline(
    'a9f40000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'evt_deadline_paid'), null,
    'a still-current deadline cannot be cancelled or refunded');
reset role;
update public.studies set deadline_at = clock_timestamp() - interval '1 minute'
where id = 'a9f40000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.expire_gate2_paid_after_deadline(
    'a9f40000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'evt_wrong_paid'), null,
    'an unrelated provider event cannot reserve a refund');
select is((public.expire_gate2_paid_after_deadline(
    'a9f40000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'evt_deadline_paid') ->> 'amountCents')::integer, 12000,
    'zero completed slots reserve the full frozen quote amount');
select is((public.expire_gate2_paid_after_deadline(
    'a9f40000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'evt_deadline_paid') ->> 'reservationId')::text,
    (select id::text from public.gate2_refund_reservations
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'exact retry returns the first immutable reservation');
reset role;
select is((select state from public.studies
    where id = 'a9f40000-0000-4000-8000-000000000001'),
    'cancelled', 'paid-after-deadline study never enters fielding');
select is((select purchased_slots from public.gate2_refund_reservations
    where study_id = 'a9f40000-0000-4000-8000-000000000001'), 12,
    'reservation records all twelve purchased slots');
select is((select fulfilled_slots from public.gate2_refund_reservations
    where study_id = 'a9f40000-0000-4000-8000-000000000001'), 0,
    'no unlaunched offer is counted as fulfilled');
select is((select count(*)::integer from public.audit_log
    where entity = 'study'
        and entity_id = 'a9f40000-0000-4000-8000-000000000001'
        and meta ->> 'reason' = 'paid_deadline_expired'), 1,
    'system cancellation records one reason and provider event');
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_deadline_1', 'evt_deadline_refunded',
    'refunded', total_cents, currency, now()
from public.gate2_quote_snapshots
where study_id = 'a9f40000-0000-4000-8000-000000000001';
set local role service_role;
select is((public.expire_gate2_paid_after_deadline(
    'a9f40000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'evt_deadline_paid') ->> 'reservationId')::text,
    (select id::text from public.gate2_refund_reservations
        where study_id = 'a9f40000-0000-4000-8000-000000000001'),
    'paid-deadline replay returns the same reservation after refund observation');
reset role;
select * from finish();
rollback;
