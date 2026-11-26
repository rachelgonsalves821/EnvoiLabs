begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9a00000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 500, now() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
values ('a9a00000-0000-4000-8000-000000000002',
    'a9a00000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'approved',
    now() - interval '2 days 1 hour', now() - interval '2 days');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9a00000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002', 'accepted', 500, now() + interval '1 day');
insert into public.sessions (id, invite_id, study_id, state, started_at, submitted_at)
values ('a9a00000-0000-4000-8000-000000000004',
    'a9a00000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001', 'approved',
    now() - interval '2 days 1 hour', now() - interval '2 days');
set local role service_role;
create temp table reserved (id uuid);
grant select, insert on reserved to service_role;
create temp table failed_reserved (id uuid);
grant select, insert on failed_reserved to service_role;
insert into reserved select public.reserve_gate2_session_payout(
    'a9a00000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000001', 500, 200000,
    'payout:a9a00000-0000-4000-8000-000000000002');
select ok((select id from reserved) is not null, 'approved session is reserved first');
reset role;
update public.respondents set ytd_payout_cents = 199000,
    ytd_payout_year = extract(year from now() at time zone 'UTC')::integer - 1
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.record_gate2_payout_observation((select id from reserved),
    'evt_ordered', 'gift_fixture', 'ordered', 500, '2026-11-23T20:00:00Z'),
    'provider order observation advances reservation');
select ok(public.record_gate2_payout_observation((select id from reserved),
    'evt_ordered', 'gift_fixture', 'ordered', 500, '2026-11-23T20:00:00Z'),
    'exact provider event retry returns prior result');
select ok(not public.record_gate2_payout_observation((select id from reserved),
    'evt_ordered', 'gift_fixture', 'ordered', 501, '2026-11-23T20:00:00Z'),
    'same provider event cannot change amount');
select ok(public.record_gate2_payout_observation((select id from reserved),
    'evt_delivered', 'gift_fixture', 'delivered', 500, '2026-11-23T21:00:00Z'),
    'provider delivery advances payout');
select ok(public.record_gate2_payout_observation((select id from reserved),
    'evt_delivered', 'gift_fixture', 'delivered', 500, '2026-11-23T21:00:00Z'),
    'delivery retry is idempotent');
select ok(not public.record_gate2_payout_observation((select id from reserved),
    'evt_late_order', 'gift_fixture', 'ordered', 500, '2026-11-23T20:30:00Z'),
    'out-of-order provider status cannot regress delivery');
select is((select count(*) from public.gate2_payout_events where payout_id = (select id from reserved)),
    2::bigint, 'only distinct provider observations are appended');
select is((select state from public.payouts where id = (select id from reserved)),
    'delivered', 'payout state matches provider delivery');
insert into failed_reserved select public.reserve_gate2_session_payout(
    'a9a00000-0000-4000-8000-000000000004',
    '90500000-0000-4000-8000-000000000002', 500, 200000,
    'payout:a9a00000-0000-4000-8000-000000000004');
select ok((select id from failed_reserved) is not null,
    'a second approved session reserves a distinct payout');
select ok(public.record_gate2_payout_observation((select id from failed_reserved),
    'evt_failed', 'gift_failed', 'failed', 500, '2026-11-23T22:00:00Z'),
    'provider failure is recorded once');
select ok(public.record_gate2_payout_observation((select id from failed_reserved),
    'evt_failed', 'gift_failed', 'failed', 500, '2026-11-23T22:00:00Z'),
    'first failed-event retry returns the prior result');
select ok(public.record_gate2_payout_observation((select id from failed_reserved),
    'evt_failed', 'gift_failed', 'failed', 500, '2026-11-23T22:00:00Z'),
    'second failed-event retry returns the prior result');
select is((select count(*) from public.gate2_payout_events
    where payout_id = (select id from failed_reserved)), 1::bigint,
    'three failed deliveries append one provider event');
select is((select state from public.payouts where id = (select id from failed_reserved)),
    'failed', 'three failed deliveries leave one terminal failed payout');
reset role;
select is((select ytd_payout_cents from public.respondents
    where id = '90500000-0000-4000-8000-000000000001'),
    500, 'new-year delivery resets prior-year total and increments once');
select is((select ytd_payout_year from public.respondents
    where id = '90500000-0000-4000-8000-000000000001'),
    extract(year from now() at time zone 'UTC')::integer,
    'delivery records the current UTC cap year');
select is((select ytd_payout_cents from public.respondents
    where id = '90500000-0000-4000-8000-000000000002'),
    0, 'failed payout replay never increments the second respondent total');
set local role authenticated;
select ok(not has_function_privilege('authenticated',
    'public.record_gate2_payout_observation(uuid,text,text,text,integer,timestamptz)', 'EXECUTE'),
    'respondent cannot assert provider delivery');
select * from finish();
rollback;
