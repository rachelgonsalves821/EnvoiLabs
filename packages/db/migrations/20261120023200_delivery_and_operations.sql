create table public.quotes (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    pricing_config_version integer not null references public.pricing_configs (version),
    line_items_json jsonb not null check (jsonb_typeof(line_items_json) = 'array'),
    total_cents integer not null check (total_cents >= 0),
    incentive_cents_per_complete integer not null check (incentive_cents_per_complete >= 0),
    feasibility_json jsonb not null check (jsonb_typeof(feasibility_json) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.payments (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    stripe_checkout_id text not null unique,
    status text not null,
    amount_cents integer not null check (amount_cents >= 0),
    refunded_cents integer not null default 0 check (refunded_cents between 0 and amount_cents),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.quality_scores (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null unique references public.sessions (id) on delete cascade,
    score integer not null check (score between 0 and 100),
    components_json jsonb not null check (jsonb_typeof(components_json) = 'object'),
    decision text not null check (decision in ('approve', 'remove', 'review')),
    decided_by uuid references public.researchers (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.removals (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null unique references public.sessions (id) on delete cascade,
    reason text not null,
    replacement_invite_id uuid references public.invites (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.payouts (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references public.sessions (id),
    bonus_ref uuid,
    respondent_id uuid not null references public.respondents (id),
    amount_cents integer not null check (amount_cents > 0),
    state text not null default 'pending' check (state in ('pending', 'ordered', 'delivered', 'failed')),
    tremendous_order_id text unique,
    idempotency_key text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((session_id is null) <> (bonus_ref is null))
);

create table public.points_entries (
    id uuid primary key default gen_random_uuid(),
    respondent_id uuid not null references public.respondents (id),
    delta integer not null check (delta <> 0),
    reason text not null,
    ref_id uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (reason, ref_id)
);

create table public.referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null references public.respondents (id),
    referee_id uuid not null unique references public.respondents (id),
    state text not null,
    bonus_payout_id uuid unique references public.payouts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (referrer_id <> referee_id)
);

create table public.reports (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    version integer not null check (version > 0),
    state text not null,
    summary_json jsonb not null check (jsonb_typeof(summary_json) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (study_id, version),
    unique (id, study_id)
);

create table public.findings (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null,
    study_id uuid not null,
    position integer not null check (position > 0),
    claim text not null,
    count integer not null,
    total integer not null check (total > 0 and count between 0 and total),
    confidence text not null check (confidence in ('high', 'medium', 'low')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (report_id, position),
    unique (id, study_id),
    foreign key (report_id, study_id) references public.reports (id, study_id) on delete cascade
);

create table public.evidence_quotes (
    id uuid primary key default gen_random_uuid(),
    finding_id uuid not null,
    transcript_id uuid not null,
    study_id uuid not null,
    start_char integer not null check (start_char >= 0),
    end_char integer not null check (end_char > start_char),
    text text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (finding_id, study_id) references public.findings (id, study_id) on delete cascade,
    foreign key (transcript_id, study_id) references public.transcripts (id, study_id) on delete cascade
);

create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    respondent_id uuid not null references public.respondents (id) on delete cascade,
    endpoint text not null unique,
    keys_json jsonb not null check (jsonb_typeof(keys_json) = 'object'),
    platform text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.llm_calls (
    id uuid primary key default gen_random_uuid(),
    purpose text not null,
    model text not null,
    input_tokens integer not null check (input_tokens >= 0),
    output_tokens integer not null check (output_tokens >= 0),
    latency_ms integer not null check (latency_ms >= 0),
    cost_micros bigint not null check (cost_micros >= 0),
    study_id uuid references public.studies (id),
    ok boolean not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.audit_log (
    id uuid primary key default gen_random_uuid(),
    entity text not null,
    entity_id uuid not null,
    from_state text,
    to_state text not null,
    actor text not null,
    at timestamptz not null default now(),
    meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.events (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    actor_type text not null,
    actor_hash text,
    study_id uuid references public.studies (id),
    props jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    relation regclass;
begin
    foreach relation in array array[
        'public.quotes', 'public.payments', 'public.quality_scores', 'public.removals', 'public.payouts',
        'public.points_entries', 'public.referrals', 'public.reports', 'public.findings',
        'public.evidence_quotes', 'public.push_subscriptions', 'public.llm_calls', 'public.audit_log', 'public.events'
    ]::regclass[] loop
        execute format('alter table %s enable row level security', relation);
        execute format('revoke all on table %s from public, anon, authenticated, service_role', relation);
        execute format('grant select, insert, update, delete on table %s to service_role', relation);
        execute format(
            'create trigger touch_updated_at before update on %s for each row execute function public.touch_updated_at()',
            relation
        );
    end loop;
end;
$$;

revoke update, delete on public.audit_log, public.events from service_role;
