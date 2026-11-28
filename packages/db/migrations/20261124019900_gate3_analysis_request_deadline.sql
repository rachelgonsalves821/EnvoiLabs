-- The server starts this request before model work. A caller-supplied deadline
-- cannot extend it, and the final proposal write checks the database clock.
create table internal.gate3_analysis_requests (
    request_id uuid primary key,
    study_id uuid not null,
    quote_id uuid not null,
    researcher_auth_user_id uuid not null,
    reviewer_receipt_id uuid not null,
    binding_digest text not null check (binding_digest ~ '^[a-f0-9]{64}$'),
    started_at timestamptz not null default clock_timestamp(),
    deadline_at timestamptz not null,
    check (deadline_at > started_at and deadline_at <= started_at + interval '41 seconds')
);
alter table internal.gate3_analysis_requests enable row level security;
revoke all on internal.gate3_analysis_requests
    from public, anon, authenticated, service_role;
create trigger immutable_gate3_analysis_requests
    before update or delete on internal.gate3_analysis_requests
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.begin_gate3_private_analysis_request(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid,
    supplied_map_provider_model text, supplied_map_prompt_version text,
    supplied_map_prompt_digest text,
    supplied_snapshot jsonb, supplied_binding_key text,
    supplied_binding_digest text, supplied_request_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare current_snapshot jsonb; prior internal.gate3_analysis_requests%rowtype;
    started timestamptz;
begin
    if supplied_request_id is null or supplied_binding_key is null
        or supplied_binding_digest !~ '^[a-f0-9]{64}$'
        or supplied_snapshot is null then return null; end if;
    current_snapshot := public.read_gate3_analyst_snapshot(
        supplied_study_id, supplied_quote_id,
        supplied_researcher_auth_user_id, supplied_map_provider_model,
        supplied_map_prompt_version, supplied_map_prompt_digest);
    if current_snapshot is null or current_snapshot <> supplied_snapshot
        or supplied_binding_digest is distinct from encode(
            pg_catalog.sha256(convert_to(supplied_binding_key, 'UTF8')), 'hex')
        or supplied_binding_key::jsonb is distinct from
            internal.gate3_analysis_binding_projection(current_snapshot)
    then return null; end if;
    select * into prior from internal.gate3_analysis_requests
        where request_id = supplied_request_id;
    if found then
        if prior.study_id = supplied_study_id
            and prior.quote_id = supplied_quote_id
            and prior.researcher_auth_user_id = supplied_researcher_auth_user_id
            and prior.reviewer_receipt_id =
                (current_snapshot ->> 'reviewerReceiptId')::uuid
            and prior.binding_digest = supplied_binding_digest
            and clock_timestamp() < prior.deadline_at
        then return prior.deadline_at; end if;
        return null;
    end if;
    started := clock_timestamp();
    insert into internal.gate3_analysis_requests (
        request_id, study_id, quote_id, researcher_auth_user_id,
        reviewer_receipt_id, binding_digest, started_at, deadline_at)
    values (supplied_request_id, supplied_study_id, supplied_quote_id,
        supplied_researcher_auth_user_id,
        (current_snapshot ->> 'reviewerReceiptId')::uuid,
        supplied_binding_digest, started, started + interval '41 seconds');
    return started + interval '41 seconds';
exception when unique_violation or invalid_text_representation then
    return null;
end;
$$;
revoke all on function public.begin_gate3_private_analysis_request(
    uuid, uuid, uuid, text, text, text, jsonb, text, text, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.begin_gate3_private_analysis_request(
    uuid, uuid, uuid, text, text, text, jsonb, text, text, uuid)
    to service_role;

-- Read the database clock after the lock wait, not in the WHERE predicate.
create function internal.gate3_analysis_request_is_live(
    supplied_request_id uuid, supplied_study_id uuid,
    supplied_quote_id uuid, supplied_researcher_auth_user_id uuid,
    supplied_reviewer_receipt_id uuid, supplied_binding_digest text
) returns boolean language plpgsql security definer set search_path = ''
    set lock_timeout = '3s' as $$
declare saved internal.gate3_analysis_requests%rowtype;
begin
    select * into saved from internal.gate3_analysis_requests
        where request_id = supplied_request_id for update;
    if not found then return false; end if;
    return saved.study_id = supplied_study_id
        and saved.quote_id = supplied_quote_id
        and saved.researcher_auth_user_id = supplied_researcher_auth_user_id
        and saved.reviewer_receipt_id = supplied_reviewer_receipt_id
        and saved.binding_digest = supplied_binding_digest
        and clock_timestamp() < saved.deadline_at;
exception when lock_not_available then return false;
end;
$$;
revoke all on function internal.gate3_analysis_request_is_live(
    uuid, uuid, uuid, uuid, uuid, text)
    from public, anon, authenticated, service_role;

create or replace function public.write_gate3_private_analysis_proposal(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid,
    supplied_map_provider_model text, supplied_map_prompt_version text,
    supplied_map_prompt_digest text,
    supplied_reduce_provider_model text, supplied_reduce_prompt_version text,
    supplied_reduce_prompt_digest text,
    supplied_snapshot jsonb, supplied_binding_key text,
    supplied_binding_digest text,
    supplied_draft jsonb, supplied_screened jsonb,
    supplied_draft_json text, supplied_screened_json text,
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
        or supplied_draft_json is null or supplied_screened_json is null
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
        or octet_length(convert_to(supplied_draft_json, 'UTF8')) > 1048576
        or octet_length(convert_to(supplied_screened_json, 'UTF8')) > 1048576
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
        or supplied_draft_json::jsonb is distinct from supplied_draft
        or supplied_screened_json::jsonb is distinct from supplied_screened
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
                    convert_to(supplied_draft_json, 'UTF8')), 'hex')
                and receipt.screened_digest = encode(pg_catalog.sha256(
                    convert_to(supplied_screened_json, 'UTF8')), 'hex'))
    then return false; end if;
    -- Lock the server-issued request only after all source/reviewer locks. The
    -- database clock is checked at the last irreversible write boundary.
    if not internal.gate3_analysis_request_is_live(
        supplied_request_id, supplied_study_id, supplied_quote_id,
        supplied_researcher_auth_user_id,
        (supplied_snapshot ->> 'reviewerReceiptId')::uuid,
        supplied_binding_digest)
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
    jsonb, text, text, jsonb, jsonb, text, text, uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.write_gate3_private_analysis_proposal(
    uuid, uuid, uuid, text, text, text, text, text, text,
    jsonb, text, text, jsonb, jsonb, text, text, uuid, uuid) to service_role;
