begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

select is((select count(*) from public.organizations), 1::bigint, 'Seed replay leaves one organization');
select is((select count(*) from public.researchers), 2::bigint, 'Seed replay leaves two researchers');
select is((select count(*) from public.respondents), 60::bigint, 'Seed replay leaves sixty respondents');
select is((select count(*) from public.studies where state = 'draft'), 1::bigint, 'Seed replay leaves one draft');
select is((select count(*) from public.profile_attributes), 360::bigint, 'Seed replay leaves six attributes per respondent');
select results_eq(
    $$select min(value_json::int), max(value_json::int) from public.profile_attributes where key = 'age'$$,
    $$values (18, 45)$$,
    'Fixture respondents span the required ages'
);
select is(
    (select count(*) from (
        select key from public.profile_attributes
        where key in ('student', 'lives_on_campus', 'food_orders_per_week')
        group by key having count(distinct value_json) > 1
    ) as varied),
    3::bigint, 'Student status, residence and ordering habits vary'
);

select * from finish();
rollback;
