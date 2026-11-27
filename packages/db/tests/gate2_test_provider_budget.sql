begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

set local role authenticated;
select throws_ok($$select public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001')$$, '42501', null,
    'researcher cannot mint a provider request budget directly');
reset role;
set local role service_role;
select throws_ok($$select * from internal.gate2_test_provider_budgets$$,
    '42501', null, 'service role cannot read private provider budget rows');
select is(public.consume_gate2_test_provider_budget(
    '00000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'status',
    'blocked', 'a foreign or absent study gets no budget');
select is(public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001') ->> 'status',
    'blocked', 'another researcher gets no budget');
select is(public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'used',
    '1', 'first authorized checkout or reconciliation call consumes one shared slot');
reset role;
create temp table budget_attempts (result jsonb);
grant select, insert on budget_attempts to service_role;
set local role service_role;
insert into budget_attempts
select public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001')
from generate_series(1, 11);
select is((select count(*) from budget_attempts where result ->> 'status' = 'allow'),
    11::bigint, 'eleven further calls share the same allowance');
select is(public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'status',
    'limited', 'thirteenth provider request is denied');
select ok((public.consume_gate2_test_provider_budget(
    '90600000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001') ->> 'retryAfterSeconds')::integer
    between 1 and 3600, 'denial supplies bounded retry time');
reset role;
select is((select used from internal.gate2_test_provider_budgets), 12,
    'denied calls do not grow the atomic budget row');
select is((select count(*) from internal.gate2_test_provider_budgets), 1::bigint,
    'invalid scope creates no budget row');
select * from finish();
rollback;
