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
    output_receipt_id uuid not null,
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

-- A separately credentialed schema validator attests the exact private AI
-- objects it accepted. No service-role caller may self-certify model text.
create role gate3_analysis_validator nologin;
create table internal.gate3_analysis_output_receipts (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null,
    reviewer_receipt_id uuid not null,
    binding_digest text not null check (binding_digest ~ '^[a-f0-9]{64}$'),
    draft_digest text not null check (draft_digest ~ '^[a-f0-9]{64}$'),
    screened_digest text not null check (screened_digest ~ '^[a-f0-9]{64}$'),
    recorded_at timestamptz not null default clock_timestamp(),
    unique (study_id, reviewer_receipt_id, binding_digest,
        draft_digest, screened_digest)
);
alter table internal.gate3_analysis_output_receipts enable row level security;
revoke all on internal.gate3_analysis_output_receipts
    from public, anon, authenticated, service_role,
        gate3_analysis_validator;
create trigger immutable_gate3_analysis_output_receipts
    before update or delete on internal.gate3_analysis_output_receipts
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.attest_gate3_private_analysis_output(
    supplied_study_id uuid, supplied_reviewer_receipt_id uuid,
    supplied_binding_digest text, supplied_draft jsonb,
    supplied_screened jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare draft_hash text; screened_hash text; prior uuid;
begin
    if supplied_study_id is null or supplied_reviewer_receipt_id is null
        or supplied_binding_digest is null
        or supplied_draft is null or supplied_screened is null
        or supplied_binding_digest !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(supplied_draft) <> 'object'
        or jsonb_typeof(supplied_screened) <> 'object'
    then return null; end if;
    draft_hash := encode(pg_catalog.sha256(
        convert_to(supplied_draft::text, 'UTF8')), 'hex');
    screened_hash := encode(pg_catalog.sha256(
        convert_to(supplied_screened::text, 'UTF8')), 'hex');
    select id into prior from internal.gate3_analysis_output_receipts
        where study_id = supplied_study_id
            and reviewer_receipt_id = supplied_reviewer_receipt_id
            and binding_digest = supplied_binding_digest
            and draft_digest = draft_hash
            and screened_digest = screened_hash;
    if found then return prior; end if;
    insert into internal.gate3_analysis_output_receipts (
        study_id, reviewer_receipt_id, binding_digest,
        draft_digest, screened_digest)
    values (supplied_study_id, supplied_reviewer_receipt_id,
        supplied_binding_digest, draft_hash, screened_hash)
    returning id into prior;
    return prior;
end;
$$;
revoke all on function public.attest_gate3_private_analysis_output(
    uuid, uuid, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.attest_gate3_private_analysis_output(
    uuid, uuid, text, jsonb, jsonb) to gate3_analysis_validator;

-- JSONB comparison checks semantic membership and ordered source identity.
-- The caller also supplies the exact serialized key that Gate 3 hashed; the
-- byte digest is checked separately so JSON formatting cannot be substituted.
create function internal.gate3_analysis_binding_projection(snapshot jsonb)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object(
        'studyId', snapshot -> 'studyId',
        'quoteId', snapshot -> 'quoteId',
        'sourceSetVersion', snapshot -> 'sourceSetVersion',
        'consentRevision', snapshot -> 'consentRevision',
        'reviewerReceiptId', snapshot -> 'reviewerReceiptId',
        'briefVersion', snapshot -> 'briefVersion',
        'pricingConfigVersion', snapshot -> 'pricingConfigVersion',
        'guideDigest', snapshot -> 'guideDigest',
        'approvedSessions', (select jsonb_agg(member.item
            order by member.item ->> 'respondentId')
            from jsonb_array_elements(snapshot -> 'approvedSessions')
                as member(item)),
        'decisionQuestion', snapshot -> 'decisionQuestion',
        'hypotheses', snapshot -> 'hypotheses',
        'guideQuestions', snapshot -> 'guideQuestions',
        'sources', (select jsonb_agg(jsonb_build_object(
            'studyId', source.item -> 'studyId',
            'transcriptId', source.item -> 'transcriptId',
            'sourceVersion', source.item -> 'sourceVersion',
            'respondentId', source.item -> 'respondentId',
            'sessionId', source.item -> 'sessionId',
            'questionId', source.item -> 'questionId',
            'redactedText', source.item -> 'redactedText',
            'policyDigest', source.item -> 'policyDigest',
            'qualificationDigest', source.item -> 'qualificationDigest',
            'receipt', source.item -> 'receipt')
            order by source.item ->> 'transcriptId')
            from jsonb_array_elements(snapshot -> 'sources') as source(item)));
$$;
revoke all on function internal.gate3_analysis_binding_projection(jsonb)
    from public, anon, authenticated, service_role;

create function public.write_gate3_private_analysis_proposal(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid,
    supplied_map_provider_model text, supplied_map_prompt_version text,
    supplied_map_prompt_digest text,
    supplied_reduce_provider_model text, supplied_reduce_prompt_version text,
    supplied_reduce_prompt_digest text,
    supplied_snapshot jsonb, supplied_binding_key text,
    supplied_binding_digest text,
    supplied_draft jsonb, supplied_screened jsonb,
    supplied_output_receipt_id uuid,
    supplied_request_id uuid
) returns boolean language plpgsql security definer set search_path = ''
    set lock_timeout = '1500ms' as $$
declare current_snapshot jsonb;
    prior pii.gate3_private_analysis_proposals%rowtype;
begin
    if supplied_study_id is null or supplied_quote_id is null
        or supplied_researcher_auth_user_id is null
        or supplied_request_id is null
        or supplied_output_receipt_id is null
        or supplied_binding_digest is null
        or supplied_binding_key is null
        or supplied_snapshot is null
        or supplied_draft is null or supplied_screened is null
        or supplied_binding_digest !~ '^[a-f0-9]{64}$'
        or coalesce(supplied_snapshot ->> 'reviewerReceiptId', '')
            !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        or jsonb_typeof(supplied_snapshot) <> 'object'
        or jsonb_typeof(supplied_snapshot -> 'sources') <> 'array'
        or jsonb_typeof(supplied_snapshot -> 'approvedSessions') <> 'array'
        or octet_length(convert_to(supplied_binding_key, 'UTF8')) > 8388608
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
        or supplied_binding_digest is distinct from encode(
            pg_catalog.sha256(convert_to(supplied_binding_key, 'UTF8')), 'hex')
        or supplied_binding_key::jsonb is distinct from
            internal.gate3_analysis_binding_projection(current_snapshot)
        or not public.authorize_gate3_analyst_snapshot(
            supplied_study_id, supplied_quote_id,
            supplied_researcher_auth_user_id, supplied_reduce_provider_model,
            supplied_reduce_prompt_version, supplied_reduce_prompt_digest,
            supplied_snapshot)
        or not exists (select 1
            from internal.gate3_analysis_output_receipts as receipt
            where receipt.id = supplied_output_receipt_id
                and receipt.study_id = supplied_study_id
                and receipt.reviewer_receipt_id =
                    (supplied_snapshot ->> 'reviewerReceiptId')::uuid
                and receipt.binding_digest = supplied_binding_digest
                and receipt.draft_digest = encode(pg_catalog.sha256(
                    convert_to(supplied_draft::text, 'UTF8')), 'hex')
                and receipt.screened_digest = encode(pg_catalog.sha256(
                    convert_to(supplied_screened::text, 'UTF8')), 'hex'))
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
        and prior.output_receipt_id = supplied_output_receipt_id
        and prior.binding_digest = supplied_binding_digest
        and prior.frozen_snapshot = supplied_snapshot
        and prior.draft_json = supplied_draft
        and prior.screened_json = supplied_screened; end if;
    insert into pii.gate3_private_analysis_proposals (
        study_id, quote_id, reviewer_receipt_id,
        map_provider_model, map_prompt_version, map_prompt_digest,
        reduce_provider_model, reduce_prompt_version, reduce_prompt_digest,
        output_receipt_id,
        binding_digest,
        request_id, frozen_snapshot, draft_json, screened_json)
    values (supplied_study_id, supplied_quote_id,
        (supplied_snapshot ->> 'reviewerReceiptId')::uuid,
        supplied_map_provider_model, supplied_map_prompt_version,
        supplied_map_prompt_digest, supplied_reduce_provider_model,
        supplied_reduce_prompt_version, supplied_reduce_prompt_digest,
        supplied_output_receipt_id,
        supplied_binding_digest, supplied_request_id,
        supplied_snapshot, supplied_draft, supplied_screened);
    return true;
exception when unique_violation or lock_not_available
    or invalid_text_representation then
    return false;
end;
$$;
revoke all on function public.write_gate3_private_analysis_proposal(
    uuid, uuid, uuid, text, text, text, text, text, text,
    jsonb, text, text, jsonb, jsonb, uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.write_gate3_private_analysis_proposal(
    uuid, uuid, uuid, text, text, text, text, text, text,
    jsonb, text, text, jsonb, jsonb, uuid, uuid) to service_role;
