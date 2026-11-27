-- Private model proposals are preparation for human review, never a report.
-- This first gated path uses conservative table locks so source, consent,
-- review and price writes cannot cross the final compare-and-store statement.
create table pii.gate3_private_analysis_proposals (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null,
    quote_id uuid not null,
    reviewer_receipt_id uuid not null,
    map_provider_model text not null,
    map_prompt_version text not null,
    map_prompt_digest text not null,
    reduce_provider_model text not null,
    reduce_prompt_version text not null,
    reduce_prompt_digest text not null,
    binding_digest text not null check (binding_digest ~ '^[a-f0-9]{64}$'),
    request_id uuid not null unique,
    frozen_snapshot jsonb not null,
    draft_json jsonb not null,
    screened_json jsonb not null,
    stored_at timestamptz not null default clock_timestamp(),
    unique (study_id, reviewer_receipt_id)
);
alter table pii.gate3_private_analysis_proposals enable row level security;
revoke all on pii.gate3_private_analysis_proposals
    from public, anon, authenticated, service_role;
create trigger immutable_gate3_private_analysis_proposals
    before update or delete on pii.gate3_private_analysis_proposals
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.write_gate3_private_analysis_proposal(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid,
    supplied_map_provider_model text, supplied_map_prompt_version text,
    supplied_map_prompt_digest text,
    supplied_reduce_provider_model text, supplied_reduce_prompt_version text,
    supplied_reduce_prompt_digest text,
    supplied_snapshot jsonb, supplied_binding_digest text,
    supplied_draft jsonb, supplied_screened jsonb,
    supplied_request_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare current_snapshot jsonb;
    prior pii.gate3_private_analysis_proposals%rowtype;
begin
    if supplied_study_id is null or supplied_quote_id is null
        or supplied_researcher_auth_user_id is null
        or supplied_request_id is null
        or supplied_binding_digest is null
        or supplied_snapshot is null
        or supplied_draft is null or supplied_screened is null
        or supplied_binding_digest !~ '^[a-f0-9]{64}$'
        or coalesce(supplied_snapshot ->> 'reviewerReceiptId', '')
            !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        or jsonb_typeof(supplied_snapshot) <> 'object'
        or jsonb_typeof(supplied_draft) <> 'object'
        or jsonb_typeof(supplied_screened) <> 'object'
        or octet_length(convert_to(supplied_draft::text, 'UTF8')) > 1048576
        or octet_length(convert_to(supplied_screened::text, 'UTF8')) > 1048576
    then return false; end if;

    -- SHARE conflicts with source writers' ROW EXCLUSIVE locks. This is
    -- deliberately coarse while the analyst path remains default-off.
    lock table public.studies, public.organizations, public.researchers,
        public.brief_versions, public.guide_questions,
        public.gate2_quote_snapshots, public.pricing_configs,
        public.gate2_payment_events, public.sessions, public.invites,
        public.respondents, public.quality_scores, public.removals,
        public.answers, public.transcripts, public.consents,
        pii.transcript_raw, pii.audio_objects,
        internal.gate1_answer_jobs, internal.gate1_redaction_policies,
        internal.gate3_analysis_source_receipts,
        internal.gate3_analysis_consent_receipts,
        internal.gate3_analysis_model_policies,
        internal.gate3_analyst_review_receipts
        in share mode;
    perform 1 from public.studies where id = supplied_study_id for update;
    if not found then return false; end if;
    current_snapshot := public.read_gate3_analyst_snapshot(
        supplied_study_id, supplied_quote_id,
        supplied_researcher_auth_user_id, supplied_map_provider_model,
        supplied_map_prompt_version, supplied_map_prompt_digest);
    if current_snapshot is null or current_snapshot <> supplied_snapshot
        or not public.authorize_gate3_analyst_snapshot(
            supplied_study_id, supplied_quote_id,
            supplied_researcher_auth_user_id, supplied_reduce_provider_model,
            supplied_reduce_prompt_version, supplied_reduce_prompt_digest,
            supplied_snapshot)
    then return false; end if;
    select * into prior from pii.gate3_private_analysis_proposals
        where request_id = supplied_request_id
            or (study_id = supplied_study_id
                and reviewer_receipt_id =
                    (supplied_snapshot ->> 'reviewerReceiptId')::uuid)
        order by stored_at limit 1;
    if found then return prior.request_id = supplied_request_id
        and prior.study_id = supplied_study_id
        and prior.quote_id = supplied_quote_id
        and prior.reviewer_receipt_id =
            (supplied_snapshot ->> 'reviewerReceiptId')::uuid
        and prior.map_provider_model = supplied_map_provider_model
        and prior.map_prompt_version = supplied_map_prompt_version
        and prior.map_prompt_digest = supplied_map_prompt_digest
        and prior.reduce_provider_model = supplied_reduce_provider_model
        and prior.reduce_prompt_version = supplied_reduce_prompt_version
        and prior.reduce_prompt_digest = supplied_reduce_prompt_digest
        and prior.binding_digest = supplied_binding_digest
        and prior.frozen_snapshot = supplied_snapshot
        and prior.draft_json = supplied_draft
        and prior.screened_json = supplied_screened; end if;
    insert into pii.gate3_private_analysis_proposals (
        study_id, quote_id, reviewer_receipt_id,
        map_provider_model, map_prompt_version, map_prompt_digest,
        reduce_provider_model, reduce_prompt_version, reduce_prompt_digest,
        binding_digest,
        request_id, frozen_snapshot, draft_json, screened_json)
    values (supplied_study_id, supplied_quote_id,
        (supplied_snapshot ->> 'reviewerReceiptId')::uuid,
        supplied_map_provider_model, supplied_map_prompt_version,
        supplied_map_prompt_digest, supplied_reduce_provider_model,
        supplied_reduce_prompt_version, supplied_reduce_prompt_digest,
        supplied_binding_digest, supplied_request_id,
        supplied_snapshot, supplied_draft, supplied_screened);
    return true;
exception when unique_violation then
    return false;
end;
$$;
revoke all on function public.write_gate3_private_analysis_proposal(
    uuid, uuid, uuid, text, text, text, text, text, text,
    jsonb, text, jsonb, jsonb, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.write_gate3_private_analysis_proposal(
    uuid, uuid, uuid, text, text, text, text, text, text,
    jsonb, text, jsonb, jsonb, uuid) to service_role;
