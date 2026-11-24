begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is((select params_json from public.pricing_configs where version = 101),
    '{"unitPriceCents":200,"incentivePerQuestionCents":100}'::jsonb,
    'marketplace economics live in a new config version');
select ok((select marketplace_active and not active from public.pricing_configs
    where version = 101), 'Gate 1 preview pricing stays separate');
select ok(not has_function_privilege('authenticated',
    'public.freeze_gate2_marketplace_quote(uuid,integer,uuid,integer,jsonb,integer,integer,jsonb)',
    'EXECUTE'), 'clients cannot bypass the service quote freeze');

update public.studies set state = 'brief_ready', target_completes = 10
where id = '90600000-0000-4000-8000-000000000001';
insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');
insert into public.guide_questions (study_id, position, text)
select '90600000-0000-4000-8000-000000000001', position,
    'Marketplace question ' || position from generate_series(1, 5) as position;

set local role service_role;
select ok(public.freeze_gate2_marketplace_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '{"expectedCompletes":10,"hours":24}') is not null,
    'service freezes the exact 10-person marketplace quote');
select is(public.freeze_gate2_marketplace_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
    10000, 500, '{"expectedCompletes":10,"hours":24}')::text,
    (select id::text from public.gate2_quote_snapshots
        where study_id = '90600000-0000-4000-8000-000000000001'),
    'exact retry retains the frozen quote ID');
select throws_ok($$select public.freeze_gate2_marketplace_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 100), 100,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":100,"amountCents":5000}]',
    5000, 200, '{"expectedCompletes":10,"hours":24}')$$,
    '23514', null, 'old active Gate 1 pricing cannot make a marketplace quote');
reset role;
update public.studies set target_completes = 9
where id = '90600000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.freeze_gate2_marketplace_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":9,"unitPriceCents":200,"amountCents":9000}]',
    9000, 500, '{"expectedCompletes":9,"hours":24}')$$,
    '23514', null, 'fewer than ten respondents cannot freeze a new marketplace quote');
select throws_ok($$select public.freeze_gate2_quote(
    '90600000-0000-4000-8000-000000000001', 1,
    (select id from public.pricing_configs where version = 101), 101,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":9,"unitPriceCents":200,"amountCents":9000}]',
    9000, 500, '{"expectedCompletes":9,"hours":24}')$$,
    '23514', null, 'legacy service RPC cannot bypass marketplace minimum');
reset role;
select throws_ok($$update public.pricing_configs
    set params_json = '{"unitPriceCents":300,"incentivePerQuestionCents":100}'
    where version = 101$$, '23514', null,
    'the used marketplace config cannot rewrite old quote economics');
select * from finish();
rollback;
