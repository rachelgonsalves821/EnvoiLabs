begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

select ok(not has_function_privilege('service_role',
    'public.commit_gate2_screening_decision(uuid,uuid,integer,text,integer,integer,text,boolean)',
    'EXECUTE'), 'service role cannot advance an offer through raw answer decision');
select ok(has_function_privilege('service_role',
    'public.commit_gate2_qualified_screening_decision(uuid,uuid,integer,text,integer,integer,text,boolean,uuid,text,text,text,text)',
    'EXECUTE'), 'source-bound decision remains available to the restricted service');
set local role service_role;
select throws_ok($$select public.commit_gate2_screening_decision(
    'a9f20000-0000-4000-8000-000000000004',
    'a9f20000-0000-4000-8000-000000000003', 1, 'supported',
    0, 1, 'qualify', true)$$, '42501', null,
    'direct raw decision execution is denied before any transition');
reset role;
select * from finish();
rollback;
