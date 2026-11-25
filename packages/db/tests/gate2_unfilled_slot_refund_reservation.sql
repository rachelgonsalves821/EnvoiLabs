begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9820000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Unfilled-slot refund fixture', 'awaiting_payment', 12, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9820000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select 'a9820000-0000-4000-8000-000000000001', n,
    'Synthetic refund question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9820000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":12,"unitPriceCents":200,"amountCents":12000}]',
    12000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'twelve purchased slots freeze at the original five-question price');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_refund_fixture', 'checkout-created:refund-fixture',
    'checkout_created', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9820000-0000-4000-8000-000000000001';
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_refund_fixture', 'paid:refund-fixture',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9820000-0000-4000-8000-000000000001';
insert into public.invites (study_id, respondent_id, state, reward_cents, expires_at)
select 'a9820000-0000-4000-8000-000000000001',
    format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    'accepted', 500, clock_timestamp() + interval '1 day'
from generate_series(1, 12) as n;
insert into public.sessions (invite_id, study_id, state)
select offer.id, offer.study_id,
    case when offer.respondent_id = '90500000-0000-4000-8000-000000000012'
        then 'quality_hold' else 'approved' end
from public.invites as offer
where offer.study_id = 'a9820000-0000-4000-8000-000000000001';
update public.studies set state = 'closed'
where id = 'a9820000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('service_role',
    'public.gate2_refund_reservations', 'INSERT'),
    'service cannot manufacture a refund reservation');
select ok(not has_function_privilege('authenticated',
    'public.reserve_gate2_unfilled_slot_refund(uuid,uuid,uuid)', 'EXECUTE'),
    'client cannot reserve a refund directly');
set local role service_role;
select throws_ok($$select public.reserve_gate2_unfilled_slot_refund(
    'a9820000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9820000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001')$$,
    '23514', null, 'quality hold must resolve before any refund reservation');
reset role;
insert into public.quality_scores (session_id, score, components_json,
    decision, decided_by)
select id, 20, '{}'::jsonb, 'remove',
    '90400000-0000-4000-8000-000000000001'
from public.sessions where study_id = 'a9820000-0000-4000-8000-000000000001'
    and state = 'quality_hold';
update public.sessions set state = 'removed'
where study_id = 'a9820000-0000-4000-8000-000000000001'
    and state = 'quality_hold';
set local role service_role;
select throws_ok($$select public.reserve_gate2_unfilled_slot_refund(
    'a9820000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9820000-0000-4000-8000-000000000001'),
    '90300000-0000-4000-8000-000000000001')$$,
    '23514', null, 'a respondent cannot reserve the researcher refund');
select is((public.reserve_gate2_unfilled_slot_refund(
    'a9820000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9820000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'amountCents')::integer,
    1000, 'twelve paid, eleven fulfilled refunds one original $10 slot');
select is((public.reserve_gate2_unfilled_slot_refund(
    'a9820000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9820000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001') ->> 'reservationId')::text,
    (select id::text from public.gate2_refund_reservations
        where study_id = 'a9820000-0000-4000-8000-000000000001'),
    'exact retry returns the one immutable refund reservation');
reset role;
select is((select unfilled_slots from public.gate2_refund_reservations
    where study_id = 'a9820000-0000-4000-8000-000000000001'), 1,
    'the reservation records one unfilled slot separately from payout');
select throws_ok($$update public.sessions set state = 'approved'
    where study_id = 'a9820000-0000-4000-8000-000000000001'
        and state = 'removed'$$, '23514', null,
    'a late approval cannot retroactively erase a reserved refund');
select throws_ok($$update public.sessions set state = 'removed'
    where study_id = 'a9820000-0000-4000-8000-000000000001'
        and state = 'approved'$$, '23514', null,
    'a late quality removal cannot increase unfilled slots after reservation');
select throws_ok($$insert into public.removals (session_id, reason)
    select interview.id, 'late synthetic quality decision'
    from public.sessions as interview
    where interview.study_id = 'a9820000-0000-4000-8000-000000000001'
        and interview.state = 'approved' limit 1$$, '23514', null,
    'a late removal record cannot change the frozen fulfilled count');
select throws_ok($$delete from public.sessions
    where study_id = 'a9820000-0000-4000-8000-000000000001'
        and state = 'approved'$$, '23514', null,
    'a fulfilled session cannot disappear after refund reservation');
select throws_ok($$update public.invites
    set respondent_id = '90500000-0000-4000-8000-000000000020'
    where study_id = 'a9820000-0000-4000-8000-000000000001'
        and respondent_id = '90500000-0000-4000-8000-000000000001'$$,
    '23514', null, 'an approved slot cannot be reassigned to another profile');
select throws_ok($$update public.gate2_refund_reservations
    set amount_cents = 1$$, '23514', 'Gate 2 ledger rows are immutable',
    'refund amount is append-only after reservation');
select * from finish();
rollback;
