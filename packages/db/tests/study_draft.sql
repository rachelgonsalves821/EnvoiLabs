begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

select ok(not has_function_privilege('anon', 'public.create_gate1_study(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE'),
    'anonymous clients cannot create a draft');
select ok(not has_function_privilege('authenticated', 'public.create_gate1_study(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE'),
    'authenticated clients cannot bypass application validation');

set local envoi_test.draft = '{"title":"Draft test","targetCompletes":3,"coreQuestions":["What happened?","What did you try?","What got in the way?","How did it end?"]}';
set local envoi_test.predicates = '[{"kind":"must","attributeKey":"student","operator":"eq","value":true,"text":"Currently a student"},{"kind":"nice","attributeKey":"preferred_food_order_channel","operator":"eq","value":"app","text":"Prefers ordering food in an app"}]';
set local role service_role;

select throws_ok($$
    select public.create_gate1_study('90400000-0000-4000-8000-000000000001',
        '90100000-0000-4000-8000-000000000002', '90700000-0000-4000-8000-000000000001',
        current_setting('envoi_test.draft')::jsonb, current_setting('envoi_test.predicates')::jsonb)
$$, '42501', null, 'a researcher cannot be scoped to another organization');

select throws_ok($$
    select public.create_gate1_study('90400000-0000-4000-8000-000000000001',
        '90100000-0000-4000-8000-000000000001', '90700000-0000-4000-8000-000000000002',
        jsonb_set(current_setting('envoi_test.draft')::jsonb, '{coreQuestions}', '[""]'),
        current_setting('envoi_test.predicates')::jsonb)
$$, '23514', null, 'guide write failure aborts the transaction');
select is((select count(*) from public.studies where id = '90700000-0000-4000-8000-000000000002'),
    0::bigint, 'a failed write leaves no study');

select lives_ok($$
    select public.create_gate1_study('90400000-0000-4000-8000-000000000001',
        '90100000-0000-4000-8000-000000000001', '90700000-0000-4000-8000-000000000001',
        current_setting('envoi_test.draft')::jsonb, current_setting('envoi_test.predicates')::jsonb)
$$, 'the owning researcher can save a draft with its children');

select is(public.create_gate1_study('90400000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001', '90700000-0000-4000-8000-000000000001',
    current_setting('envoi_test.draft')::jsonb, current_setting('envoi_test.predicates')::jsonb),
    '{"studyId":"90700000-0000-4000-8000-000000000001","state":"draft"}'::jsonb,
    'a duplicate save returns the original draft');
select is((select count(*) from public.brief_versions where study_id = '90700000-0000-4000-8000-000000000001'),
    1::bigint, 'duplicate save leaves one brief version');
select is((select count(*) from public.criteria where study_id = '90700000-0000-4000-8000-000000000001'),
    2::bigint, 'duplicate save leaves two criteria');
select is((select count(*) from public.audit_log where entity_id = '90700000-0000-4000-8000-000000000001'),
    1::bigint, 'duplicate save writes no extra audit entry');
select throws_ok($$
    select public.create_gate1_study('90400000-0000-4000-8000-000000000002',
        '90100000-0000-4000-8000-000000000001', '90700000-0000-4000-8000-000000000001',
        current_setting('envoi_test.draft')::jsonb, current_setting('envoi_test.predicates')::jsonb)
$$, '23505', null, 'another researcher cannot replay this draft request');

select * from finish();
rollback;
