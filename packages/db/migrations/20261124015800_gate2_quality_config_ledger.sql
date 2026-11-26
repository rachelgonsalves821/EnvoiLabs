-- The v1 weights in the build plan are proposed, not an active removal policy.
-- A later approved migration may insert a new active version; old decisions
-- must continue to cite the exact immutable version they used.
create table internal.gate2_quality_configs (
    version integer primary key check (version > 0),
    status text not null check (status in ('proposed', 'active')),
    specificity_weight integer not null check (specificity_weight between 0 and 100),
    relevance_weight integer not null check (relevance_weight between 0 and 100),
    profile_consistency_weight integer not null check (profile_consistency_weight between 0 and 100),
    behavioral_weight integer not null check (behavioral_weight between 0 and 100),
    liveness_weight integer not null check (liveness_weight between 0 and 100),
    approve_at integer not null check (approve_at between 1 and 100),
    remove_below integer not null check (remove_below between 0 and 99),
    policy_receipt text not null check (length(btrim(policy_receipt)) between 8 and 200),
    created_at timestamptz not null default now(),
    check (specificity_weight + relevance_weight + profile_consistency_weight +
        behavioral_weight + liveness_weight = 100),
    check (remove_below < approve_at)
);
create unique index gate2_one_active_quality_config
    on internal.gate2_quality_configs (status) where status = 'active';
alter table internal.gate2_quality_configs enable row level security;
revoke all on internal.gate2_quality_configs
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_quality_configs before update or delete
    on internal.gate2_quality_configs for each row
    execute function internal.reject_gate2_ledger_mutation();

insert into internal.gate2_quality_configs (
    version, status, specificity_weight, relevance_weight,
    profile_consistency_weight, behavioral_weight, liveness_weight,
    approve_at, remove_below, policy_receipt)
values (1, 'proposed', 30, 25, 20, 15, 10, 60, 45,
    'build-plan-quality-v1-proposal');
