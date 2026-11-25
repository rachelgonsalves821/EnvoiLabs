begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9840000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Synthetic paid matching', 'awaiting_payment', 10, 10,
    clock_timestamp() + interval '3 days');
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('a9840000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select 'a9840000-0000-4000-8000-000000000001', n,
    'Synthetic matching question ' || n from generate_series(1, 5) as n;
set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    'a9840000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '90200000-0000-4000-8000-000000000001') is not null,
    'marketplace matching uses a frozen five-question $2/$1 quote');
reset role;
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_matching', 'checkout-created:matching',
    'checkout_created', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9840000-0000-4000-8000-000000000001';
insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents,
    currency, provider_observed_at)
select id, study_id, 'cs_test_matching', 'paid:matching',
    'paid', total_cents, 'usd', clock_timestamp()
from public.gate2_quote_snapshots
where study_id = 'a9840000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.launch_gate2_paid_study(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'paid:matching'), 'only the paid quote enters fielding');
reset role;
update auth.users set email_confirmed_at = clock_timestamp()
where id in (select format('90300000-0000-4000-8000-%s',
    lpad(n::text, 12, '0'))::uuid from generate_series(21, 33) as n);
insert into public.profile_attributes (respondent_id, key, value_json, source)
select respondent.id, item.key, item.value_json, 'signup'
from public.respondents as respondent
cross join (values
    ('age_range', '"25-34"'::jsonb), ('gender', '"undisclosed"'::jsonb),
    ('student_year', '"not_student"'::jsonb),
    ('online_shopping_frequency', '"weekly"'::jsonb),
    ('region_zip', '"10001"'::jsonb),
    ('interests', '["food"]'::jsonb)) as item(key, value_json)
where respondent.id in (select format('90500000-0000-4000-8000-%s',
    lpad(n::text, 12, '0'))::uuid from generate_series(21, 33) as n);
insert into public.consents (respondent_id, purpose, granted, text_version)
select respondent.id, purpose, true, 'synthetic-matching-only'
from public.respondents as respondent
cross join unnest(array['retention', 'researcher_access']) as consent(purpose)
where respondent.id in (select format('90500000-0000-4000-8000-%s',
    lpad(n::text, 12, '0'))::uuid from generate_series(21, 33) as n);
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000031', 'retention', false,
    'synthetic-revocation');
insert into public.invites (study_id, respondent_id, state, reward_cents, expires_at)
values ('90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000032', 'invited', 0,
    clock_timestamp() + interval '1 day');
insert into public.invites (study_id, respondent_id, state, reward_cents,
    expires_at) values ('90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000033', 'accepted', 0,
    clock_timestamp() - interval '1 day');
insert into public.sessions (invite_id, study_id, state)
select id, study_id, 'in_progress' from public.invites
where respondent_id = '90500000-0000-4000-8000-000000000033';
select ok(not has_function_privilege('authenticated',
    'public.create_gate2_marketplace_offers(uuid,uuid,uuid,integer)', 'EXECUTE'),
    'no respondent or researcher can directly send offers');
select ok(not has_function_privilege('authenticated',
    'public.create_gate2_paid_launch_wave(uuid,uuid)', 'EXECUTE'),
    'clients cannot trigger a paid launch wave');
set local role service_role;
select throws_ok($$select public.create_gate2_marketplace_offers(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    '90300000-0000-4000-8000-000000000021', 20)$$,
    '23514', null, 'respondent cannot match a researcher study');
select is((public.create_gate2_paid_launch_wave(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001')) ->> 'created')::integer,
    10, 'paid cap excludes revoked, conflicting and ongoing profiles');
select is((public.create_gate2_marketplace_offers(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    '90200000-0000-4000-8000-000000000001', 20) ->> 'created')::integer,
    0, 'retry does not issue duplicate offers');
reset role;
select is((select count(*)::integer from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'), 10,
    'offer identities remain unique');
select is((select min(reward_cents) from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'), 500,
    'each five-question offer carries frozen $1 per question reward');
select * from finish();
rollback;
