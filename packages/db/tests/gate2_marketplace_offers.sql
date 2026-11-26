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
update public.studies set deadline_at = clock_timestamp() - interval '1 minute'
where id = 'a9840000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.launch_gate2_paid_study_checked(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'paid:matching'), false,
    'paid checkout after deadline cannot launch a marketplace study');
select throws_ok($$select public.launch_gate2_paid_study(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'paid:matching')$$, '23514', null,
    'legacy privileged launch cannot bypass the table deadline guard');
reset role;
update public.studies set deadline_at = clock_timestamp() + interval '3 days'
where id = 'a9840000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.launch_gate2_paid_study_checked(
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
select ok(not has_function_privilege('authenticated',
    'public.decide_gate2_marketplace_quality(uuid,uuid,uuid,uuid,text,integer,jsonb,text)',
    'EXECUTE'), 'clients cannot directly decide quality or send replacements');
select ok(not has_table_privilege('service_role', 'public.quality_scores', 'INSERT'),
    'service must use the restricted reviewed decision');
-- A newly verified matching profile joins after the paid initial wave.
update auth.users set email_confirmed_at = clock_timestamp()
where id = '90300000-0000-4000-8000-000000000034';
insert into public.profile_attributes (respondent_id, key, value_json, source)
select '90500000-0000-4000-8000-000000000034', item.key, item.value_json, 'signup'
from (values
    ('age_range', '"25-34"'::jsonb), ('gender', '"undisclosed"'::jsonb),
    ('student_year', '"not_student"'::jsonb),
    ('online_shopping_frequency', '"weekly"'::jsonb),
    ('region_zip', '"10001"'::jsonb),
    ('interests', '["food"]'::jsonb)) as item(key, value_json);
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000034', 'retention', true,
    'synthetic-matching-only'),
    ('90500000-0000-4000-8000-000000000034', 'researcher_access', true,
    'synthetic-matching-only');
update public.invites set state = 'accepted'
where id = (select id from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'
    order by respondent_id limit 1);
insert into public.sessions (id, invite_id, study_id, state,
    started_at, submitted_at)
select 'a9840000-0000-4000-8000-000000000099', id, study_id,
    'quality_hold', now() - interval '2 hours', now() - interval '1 hour'
from public.invites where study_id = 'a9840000-0000-4000-8000-000000000001'
    and state = 'accepted';
set local role service_role;
select throws_ok($$update public.sessions set state = 'removed'
    where id = 'a9840000-0000-4000-8000-000000000099'$$,
    '23514', null, 'direct quality removal cannot bypass the decision record');
select throws_ok($$select public.decide_gate2_marketplace_quality(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'a9840000-0000-4000-8000-000000000099',
    '90300000-0000-4000-8000-000000000021',
    'remove', 20, '{}'::jsonb, 'synthetic quality failure')$$,
    '42501', null, 'respondent cannot decide a research study quality result');
select is((public.decide_gate2_marketplace_quality(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'a9840000-0000-4000-8000-000000000099',
    '90200000-0000-4000-8000-000000000001',
    'remove', 20, '{}'::jsonb, 'synthetic quality failure')
    -> 'replacement' ->> 'created')::integer, 1,
    'reviewed removal creates one replacement within purchased capacity');
select is((public.decide_gate2_marketplace_quality(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'a9840000-0000-4000-8000-000000000099',
    '90200000-0000-4000-8000-000000000001',
    'remove', 20, '{}'::jsonb, 'synthetic quality failure')
    -> 'replacement' ->> 'created')::integer, 0,
    'same decision replay creates no second replacement');
reset role;
select is((select count(*)::integer from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'), 11,
    'quality removal plus replacement preserves one extra historical offer');
select is((select count(*)::integer from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'
        and state in ('invited', 'accepted', 'screening')), 10,
    'exactly ten active offers remain after replacement');
select is((select count(*)::integer from public.removals
    where session_id = 'a9840000-0000-4000-8000-000000000099'), 1,
    'reviewed removal has one private reason record');
update public.invites set state = 'accepted'
where id = (select id from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'
        and state = 'invited' order by respondent_id limit 1);
insert into public.sessions (id, invite_id, study_id, state,
    started_at, submitted_at)
select 'a9840000-0000-4000-8000-000000000098', id, study_id,
    'quality_hold', now() - interval '2 hours', now() - interval '1 hour'
from public.invites where study_id = 'a9840000-0000-4000-8000-000000000001'
    and state = 'accepted' and not exists (select 1 from public.sessions
        where invite_id = public.invites.id);
set local role service_role;
select is(public.decide_gate2_marketplace_quality(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'a9840000-0000-4000-8000-000000000098',
    '90200000-0000-4000-8000-000000000001',
    'approve', 80, '{}'::jsonb, null) ->> 'decision',
    'approve', 'reviewed approval records a qualified completed slot');
select is(public.decide_gate2_marketplace_quality(
    'a9840000-0000-4000-8000-000000000001',
    (select id from public.gate2_quote_snapshots
        where study_id = 'a9840000-0000-4000-8000-000000000001'),
    'a9840000-0000-4000-8000-000000000098',
    '90200000-0000-4000-8000-000000000001',
    'approve', 80, '{}'::jsonb, null) ->> 'decision',
    'approve', 'approved quality decision replays without another effect');
reset role;
select is((select state from public.sessions
    where id = 'a9840000-0000-4000-8000-000000000098'),
    'approved', 'approved session remains in purchased capacity');
insert into public.studies (id, organization_id, title, state,
    target_completes, length_minutes, deadline_at)
values ('a9840000-0000-4000-8000-000000000002',
    '90100000-0000-4000-8000-000000000001',
    'Later synthetic match', 'brief_ready', 10, 10,
    clock_timestamp() + interval '3 days');
select ok(exists (
    select 1 from internal.gate2_marketplace_candidates(
        'a9840000-0000-4000-8000-000000000002') as eligible
    join public.invites as prior on prior.respondent_id = eligible.respondent_id
    where prior.id = (select invite_id from public.sessions
        where id = 'a9840000-0000-4000-8000-000000000098')
), 'approved respondent can match a later study before old offer expiry');
select ok(not exists (
    select 1 from internal.gate2_marketplace_candidates(
        'a9840000-0000-4000-8000-000000000002')
    where respondent_id = '90500000-0000-4000-8000-000000000033'
), 'in-progress respondent remains unavailable for a later study');
update public.invites set state = 'accepted'
where study_id = 'a9840000-0000-4000-8000-000000000001'
    and state = 'invited';
insert into public.sessions (invite_id, study_id, state, started_at, submitted_at)
select offer.id, offer.study_id, 'quality_hold',
    now() - interval '2 hours', now() - interval '1 hour'
from public.invites as offer
where offer.study_id = 'a9840000-0000-4000-8000-000000000001'
    and offer.state = 'accepted'
    and not exists (select 1 from public.sessions as prior
        where prior.invite_id = offer.id);
set local role service_role;
do $$
declare candidate uuid;
begin
    for candidate in select id from public.sessions
        where study_id = 'a9840000-0000-4000-8000-000000000001'
            and state = 'quality_hold'
    loop
        perform public.decide_gate2_marketplace_quality(
            'a9840000-0000-4000-8000-000000000001',
            (select id from public.gate2_quote_snapshots
                where study_id = 'a9840000-0000-4000-8000-000000000001'),
            candidate, '90200000-0000-4000-8000-000000000001',
            'approve', 80, '{}'::jsonb, null);
    end loop;
end;
$$;
reset role;
select is((select count(*)::integer from public.sessions
    where study_id = 'a9840000-0000-4000-8000-000000000001'
        and state = 'approved'), 10,
    'reviewed replacement wave reaches all ten purchased approved completes');
select is((select count(*)::integer from public.invites
    where study_id = 'a9840000-0000-4000-8000-000000000001'), 11,
    'target attainment creates no further replacement offer');
select * from finish();
rollback;
