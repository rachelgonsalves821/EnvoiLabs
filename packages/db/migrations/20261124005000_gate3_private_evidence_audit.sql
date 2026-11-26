-- Private proposals and analyst decisions are evidence, never researcher output.
create table pii.gate3_evidence_proposals (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    report_id uuid,
    candidate_json jsonb not null check (jsonb_typeof(candidate_json) = 'object'),
    model_name text not null check (btrim(model_name) <> ''),
    model_version text not null check (btrim(model_version) <> ''),
    prompt_version text not null check (btrim(prompt_version) <> ''),
    private_rationale text not null check (btrim(private_rationale) <> ''),
    proposed_at timestamptz not null default now(),
    unique (id, study_id),
    foreign key (report_id, study_id) references public.reports (id, study_id)
);
create table pii.gate3_evidence_decisions (
    id uuid primary key default gen_random_uuid(),
    proposal_id uuid not null references pii.gate3_evidence_proposals (id),
    action text not null check (action in ('accept', 'edit', 'drop')),
    actor_id text not null check (btrim(actor_id) <> ''),
    causation_id uuid not null,
    private_note text,
    edited_claim text,
    edited_quote_text text,
    decided_at timestamptz not null default now(),
    unique (proposal_id, causation_id),
    check (action = 'edit' or (edited_claim is null and edited_quote_text is null)),
    check (action <> 'edit' or nullif(btrim(coalesce(edited_claim, '')), '') is not null
        or nullif(btrim(coalesce(edited_quote_text, '')), '') is not null)
);
alter table pii.gate3_evidence_proposals enable row level security;
alter table pii.gate3_evidence_decisions enable row level security;
revoke all on pii.gate3_evidence_proposals, pii.gate3_evidence_decisions
    from public, anon, authenticated, service_role;
grant select, insert on pii.gate3_evidence_proposals, pii.gate3_evidence_decisions
    to service_role;
create trigger immutable_gate3_proposal before update or delete on pii.gate3_evidence_proposals
    for each row execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate3_decision before update or delete on pii.gate3_evidence_decisions
    for each row execute function internal.reject_gate2_ledger_mutation();
