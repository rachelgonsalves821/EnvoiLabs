begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is((select count(*) from internal.gate2_quality_configs
    where status = 'active'), 0::bigint,
    'automatic quality policy is not active before approval');
select is((select jsonb_build_object('version', version,
    'weights', jsonb_build_object('specificity', specificity_weight,
        'relevance', relevance_weight,
        'profileConsistency', profile_consistency_weight,
        'behavioral', behavioral_weight, 'liveness', liveness_weight),
    'approveAt', approve_at, 'removeBelow', remove_below)
    from internal.gate2_quality_configs where version = 1),
    '{"version":1,"weights":{"specificity":30,"relevance":25,"profileConsistency":20,"behavioral":15,"liveness":10},"approveAt":60,"removeBelow":45}'::jsonb,
    'proposed version records the exact scorer inputs');
select ok(not has_table_privilege('service_role',
    'internal.gate2_quality_configs', 'SELECT') and
    not has_table_privilege('authenticated',
    'internal.gate2_quality_configs', 'SELECT'),
    'clients and generic service role cannot inspect private policy table');
select throws_ok($$update internal.gate2_quality_configs
    set approve_at = 50 where version = 1$$, '23514', null,
    'a proposed policy cannot be rewritten after recording');
select throws_ok($$insert into internal.gate2_quality_configs (
    version, status, specificity_weight, relevance_weight,
    profile_consistency_weight, behavioral_weight, liveness_weight,
    approve_at, remove_below, policy_receipt)
    values (2, 'proposed', 30, 25, 20, 15, 11, 60, 45, 'invalid-weight-receipt')$$,
    '23514', null, 'weights must sum to one hundred');
select throws_ok($$insert into internal.gate2_quality_configs (
    version, status, specificity_weight, relevance_weight,
    profile_consistency_weight, behavioral_weight, liveness_weight,
    approve_at, remove_below, policy_receipt)
    values (2, 'proposed', 30, 25, 20, 15, 10, 45, 45, 'invalid-threshold-receipt')$$,
    '23514', null, 'remove and approve thresholds cannot overlap');
select * from finish();
rollback;
