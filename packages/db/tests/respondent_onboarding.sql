begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

insert into auth.users (id, email, email_confirmed_at) values
    ('90700000-0000-4000-8000-000000000001', 'onboarding-a@example.test', now()),
    ('90700000-0000-4000-8000-000000000002', 'onboarding-b@example.test', now()),
    ('90700000-0000-4000-8000-000000000003', 'onboarding-unverified@example.test', null);
insert into public.respondents (id, auth_user_id, age_attested_at) values
    ('90700000-0000-4000-9000-000000000001', '90700000-0000-4000-8000-000000000001', now()),
    ('90700000-0000-4000-9000-000000000002', '90700000-0000-4000-8000-000000000002', now()),
    ('90700000-0000-4000-9000-000000000003', '90700000-0000-4000-8000-000000000003', now());

select ok(not has_function_privilege('anon', 'public.save_gate1_profile(jsonb)', 'EXECUTE'),
    'anonymous users cannot save a profile');
select ok(not has_function_privilege('anon', 'public.save_gate1_consent(jsonb)', 'EXECUTE'),
    'anonymous users cannot save consent');
select ok(not has_table_privilege('authenticated', 'public.profile_attributes', 'INSERT'),
    'respondents cannot bypass profile validation');
select ok(not has_table_privilege('authenticated', 'public.consents', 'INSERT'),
    'respondents cannot bypass consent validation');

set local role authenticated;
set local request.jwt.claims = '{"sub":"90700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select lives_ok($$select public.save_gate1_profile(
    '[{"key":"student_year","value":"year_2"},{"key":"food_orders_per_week","value":3}]'
)$$, 'a verified respondent can save typed profile answers');
select is((select value_json from public.profile_attributes where key = 'student'), 'true'::jsonb,
    'student year preserves the boolean matching attribute');
select is((select value_json from public.profile_attributes where key = 'food_orders_per_week'), '3'::jsonb,
    'weekly orders preserve the numeric matching attribute');
select throws_ok($$select public.save_gate1_profile(
    '[{"key":"region_zip","value":"02139"},{"key":"region_zip","value":"02138"}]'
)$$, '22023', null, 'duplicated profile attributes fail');
select is((select count(*) from public.profile_attributes where key = 'region_zip'), 0::bigint,
    'a rejected profile batch leaves no partial update');
select throws_ok($$select public.save_gate1_profile(
    '[{"key":"age_range","value":"18-24","respondentId":"90700000-0000-4000-9000-000000000002"}]'
)$$, '22023', null, 'the profile operation rejects an asserted respondent ID');

select lives_ok($$select public.save_gate1_consent('[
    {"purpose":"recording","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"transcription_vendor","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"retention","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"researcher_access","granted":false,"textVersion":"gate1-preview-v1"}
]')$$, 'all four explicit denials can be saved');
select is((select count(*) from public.consents where not granted and text_version = 'gate1-preview-v1'),
    4::bigint, 'four separate denied purposes are persisted with their version');
select lives_ok($$select public.save_gate1_consent('[
    {"purpose":"recording","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"transcription_vendor","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"retention","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"researcher_access","granted":false,"textVersion":"gate1-preview-v1"}
]')$$, 'identical retry succeeds');
select is((select count(*) from public.consents), 4::bigint, 'retry adds no duplicate consent history');
select throws_ok($$select public.save_gate1_consent('[
    {"purpose":"recording","granted":true,"textVersion":"old"},
    {"purpose":"transcription_vendor","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"retention","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"researcher_access","granted":false,"textVersion":"gate1-preview-v1"}
]')$$, '22023', null, 'a stale recording policy cannot grant consent');
select lives_ok($$select public.save_gate1_consent('[
    {"purpose":"recording","granted":true,"textVersion":"gate1-preview-v1"},
    {"purpose":"transcription_vendor","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"retention","granted":false,"textVersion":"gate1-preview-v1"},
    {"purpose":"researcher_access","granted":false,"textVersion":"gate1-preview-v1"}
]')$$, 'one later choice can change without re-appending the other purposes');
select is((select count(*) from public.consents), 5::bigint, 'only the changed choice appends history');

set local request.jwt.claims = '{"sub":"90700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(*) from public.profile_attributes), 0::bigint, 'another respondent cannot read the profile');
select is((select count(*) from public.consents), 0::bigint, 'another respondent cannot read consent history');

set local request.jwt.claims = '{"sub":"90700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';
select throws_ok($$select public.save_gate1_profile('[{"key":"region_zip","value":"02139"}]')$$,
    '42501', null, 'an unverified identity cannot write onboarding');
reset role;
select * from finish();
rollback;
