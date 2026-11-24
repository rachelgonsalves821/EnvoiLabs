begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values
    ('99620000-0000-4000-8000-000000000001', '90600000-0000-4000-8000-000000000001',
     '90500000-0000-4000-8000-000000000001', 'accepted', 500, now() + interval '1 day'),
    ('99620000-0000-4000-8000-000000000002', '90600000-0000-4000-8000-000000000001',
     '90500000-0000-4000-8000-000000000002', 'accepted', 2000, now() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
values
    ('99620000-0000-4000-8000-000000000003', '99620000-0000-4000-8000-000000000001',
     '90600000-0000-4000-8000-000000000001', 'approved',
     now() - interval '2 days 1 hour', now() - interval '2 days'),
    ('99620000-0000-4000-8000-000000000004', '99620000-0000-4000-8000-000000000002',
     '90600000-0000-4000-8000-000000000001', 'approved',
     now() - interval '2 days 1 hour', now() - interval '2 days');
update public.respondents set ytd_payout_cents = 199000
where id = '90500000-0000-4000-8000-000000000002';

select ok(has_function_privilege('service_role',
    'public.reserve_gate2_session_payout(uuid,uuid,integer,integer,text)', 'EXECUTE'),
    'only the service can reserve a payout');
select ok(not has_function_privilege('authenticated',
    'public.reserve_gate2_session_payout(uuid,uuid,integer,integer,text)', 'EXECUTE'),
    'respondents cannot call the reservation');
select ok(not has_table_privilege('service_role', 'public.payouts', 'INSERT'),
    'service must use the locking reservation function');

set local role service_role;
select ok(public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 500, 200000,
    'payout:99620000-0000-4000-8000-000000000003') is not null,
    'approved held session reserves its exact reward');
select is((select count(*) from public.payouts where session_id =
    '99620000-0000-4000-8000-000000000003'), 1::bigint, 'one reservation exists');
select is(public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 500, 200000,
    'payout:99620000-0000-4000-8000-000000000003'),
    (select id from public.payouts where session_id =
    '99620000-0000-4000-8000-000000000003'), 'retry returns the same reservation');
select throws_ok($$select public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000004',
    '90500000-0000-4000-8000-000000000002', 2000, 200000,
    'payout:99620000-0000-4000-8000-000000000004')$$,
    '23514', null, '$1,990 YTD cannot reserve another $20');
reset role;
update public.respondents set ytd_payout_year =
    extract(year from now() at time zone 'UTC')::integer - 1
where id = '90500000-0000-4000-8000-000000000002';
insert into public.payouts (id, bonus_ref, respondent_id, amount_cents, idempotency_key, created_at)
values ('99620000-0000-4000-8000-000000000005',
    '99620000-0000-4000-8000-000000000005',
    '90500000-0000-4000-8000-000000000002', 198000,
    'old-year-pending-fixture', now() - interval '1 year');
set local role service_role;
select throws_ok($$select public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000004',
    '90500000-0000-4000-8000-000000000002', 2000, 200000,
    'payout:99620000-0000-4000-8000-000000000004')$$,
    '23514', null, 'old-year pending order still reserves new-year capacity');
reset role;
delete from public.payouts where id = '99620000-0000-4000-8000-000000000005';
set local role service_role;
select ok(public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000004',
    '90500000-0000-4000-8000-000000000002', 2000, 200000,
    'payout:99620000-0000-4000-8000-000000000004') is not null,
    'prior-year delivered total does not block a new-year reward');
reset role;
select is((select ytd_payout_year from public.respondents
    where id = '90500000-0000-4000-8000-000000000002'),
    extract(year from now() at time zone 'UTC')::integer - 1,
    'reservation does not rewrite delivered-year accounting');
set local role service_role;
select throws_ok($$select public.reserve_gate2_session_payout(
    '99620000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000001', 501, 200000,
    'payout:99620000-0000-4000-8000-000000000003')$$,
    '23505', null, 'same key cannot change payout amount');
select throws_ok($$update public.gate2_payout_events set event_kind = 'failed'$$,
    '42501', null, 'service cannot mutate provider evidence');
select * from finish();
rollback;
