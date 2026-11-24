begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes)
values ('a9800000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'Open marketplace feasibility fixture', 'brief_ready', 10, 10);
insert into public.criteria (study_id, kind, attribute_key, operator,
    value_json, text) values
    ('a9800000-0000-4000-8000-000000000001', 'must',
        'food_orders_per_week', 'gte', '0', 'Orders food'),
    ('a9800000-0000-4000-8000-000000000001', 'exclude',
        'lives_on_campus', 'eq', 'true', 'Lives on campus');
update auth.users set email_confirmed_at = clock_timestamp()
where id in (select auth_user_id from public.respondents where id in (
    '90500000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000004'));
insert into public.profile_attributes (respondent_id, key, value_json, source)
select respondent.id, item.key, item.value_json, 'signup'
from public.respondents as respondent
cross join (values
    ('age_range', '"25-34"'::jsonb), ('gender', '"undisclosed"'::jsonb),
    ('student_year', '"not_student"'::jsonb),
    ('online_shopping_frequency', '"weekly"'::jsonb),
    ('region_zip', '"10001"'::jsonb),
    ('interests', '["food","shopping"]'::jsonb)) as item(key, value_json)
where respondent.id in (
    '90500000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000004');
insert into public.consents (respondent_id, purpose, granted, text_version)
select respondent.id, purpose, true, 'synthetic-marketplace-only'
from public.respondents as respondent
cross join unnest(array['retention', 'researcher_access']) as consent(purpose)
where respondent.id in (
    '90500000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000002',
    '90500000-0000-4000-8000-000000000003',
    '90500000-0000-4000-8000-000000000004');
update public.respondents set status = 'paused'
where id = '90500000-0000-4000-8000-000000000004';
insert into public.invites (study_id, respondent_id, state, reward_cents, expires_at)
values ('90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000003', 'invited', 0,
    clock_timestamp() + interval '1 hour');
insert into public.invites (id, study_id, respondent_id, state,
    reward_cents, expires_at)
values ('a9800000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 0,
    clock_timestamp() - interval '1 day');
insert into public.sessions (invite_id, study_id, state, started_at, submitted_at)
values ('a9800000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001', 'submitted',
    clock_timestamp() - interval '1 day 1 hour',
    clock_timestamp() - interval '1 day');

select ok(not has_function_privilege('authenticated',
    'public.read_gate2_marketplace_feasibility(uuid,uuid)', 'EXECUTE'),
    'clients cannot read marketplace supply counts directly');
select ok(not has_function_privilege('service_role',
    'internal.gate2_marketplace_candidates(uuid)', 'EXECUTE'),
    'candidate identity rows remain private');
set local role service_role;
select throws_ok($$select public.read_gate2_marketplace_feasibility(
    'a9800000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001')$$,
    '42501', null, 'a respondent cannot inspect researcher supply');
select is(public.read_gate2_marketplace_feasibility(
    'a9800000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'eligibleProfileCount',
    '1', 'only one complete, consented, email-verified active profile remains');
select is(public.read_gate2_marketplace_feasibility(
    'a9800000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') -> 'history' ->> 'completed',
    '1', 'history counts an observed complete for the eligible profile');
select is(public.read_gate2_marketplace_feasibility(
    'a9800000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'basis',
    'insufficient_history', 'one observation is not an estimated fill promise');
select is(public.read_gate2_marketplace_feasibility(
    'a9800000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') -> 'fillHours',
    'null'::jsonb, 'no fill-time estimate is invented');
reset role;
select * from finish();
rollback;
