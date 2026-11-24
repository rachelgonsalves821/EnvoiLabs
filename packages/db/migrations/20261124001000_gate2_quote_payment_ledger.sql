-- Gate 2 uses immutable quote and provider-observation rows. Gate 1's quotes/payments
-- remain available to existing preview callers until the dependent service migrates.
alter table public.pricing_configs add constraint pricing_configs_id_version_unique unique (id, version);

create table public.gate2_quote_snapshots (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    brief_version integer not null,
    guide_digest text not null check (guide_digest ~ '^[a-f0-9]{64}$'),
    pricing_config_id uuid not null,
    pricing_config_version integer not null,
    currency text not null default 'usd' check (currency = 'usd'),
    line_items_json jsonb not null check (jsonb_typeof(line_items_json) = 'array'),
    total_cents integer not null check (total_cents > 0),
    incentive_cents_per_complete integer not null check (incentive_cents_per_complete >= 0),
    feasibility_json jsonb not null check (jsonb_typeof(feasibility_json) = 'object'),
    created_at timestamptz not null default now(),
    foreign key (study_id, brief_version) references public.brief_versions (study_id, version),
    foreign key (pricing_config_id, pricing_config_version)
        references public.pricing_configs (id, version),
    unique (study_id, brief_version, guide_digest, pricing_config_version),
    unique (id, study_id)
);

create table public.gate2_payment_events (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null,
    study_id uuid not null,
    provider_checkout_id text not null check (btrim(provider_checkout_id) <> ''),
    provider_event_id text not null unique check (btrim(provider_event_id) <> ''),
    event_kind text not null check (event_kind in ('checkout_created', 'paid', 'refunded', 'failed')),
    amount_cents integer not null check (amount_cents > 0),
    currency text not null check (currency = 'usd'),
    provider_observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    foreign key (quote_id, study_id) references public.gate2_quote_snapshots (id, study_id)
);

create unique index gate2_one_paid_event_per_quote
    on public.gate2_payment_events (quote_id) where event_kind = 'paid';
create index gate2_payment_events_by_checkout
    on public.gate2_payment_events (provider_checkout_id, created_at);

alter table public.gate2_quote_snapshots enable row level security;
alter table public.gate2_payment_events enable row level security;
revoke all on public.gate2_quote_snapshots, public.gate2_payment_events
    from public, anon, authenticated, service_role;
grant select, insert on public.gate2_quote_snapshots, public.gate2_payment_events to service_role;

-- A researcher can read the frozen price for their organization after MFA, but
-- provider events and incentives are service-only.
grant select (id, study_id, brief_version, guide_digest, pricing_config_version,
    currency, line_items_json, total_cents, feasibility_json, created_at)
    on public.gate2_quote_snapshots to authenticated;
create policy tenant_gate2_quote on public.gate2_quote_snapshots
    for select to authenticated using (internal.researches_study(study_id));

create function internal.reject_gate2_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
    raise exception 'Gate 2 ledger rows are immutable' using errcode = '23514';
end;
$$;
revoke all on function internal.reject_gate2_ledger_mutation() from public, anon, authenticated, service_role;
create trigger immutable_gate2_quote before update or delete on public.gate2_quote_snapshots
    for each row execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_payment_event before update or delete on public.gate2_payment_events
    for each row execute function internal.reject_gate2_ledger_mutation();
