-- A separate validator credential may only attest bytes that name current
-- qualified sources and a plausible screened evidence structure.
create or replace function public.attest_gate3_private_analysis_output(
    supplied_study_id uuid, supplied_reviewer_receipt_id uuid,
    supplied_binding_digest text, supplied_draft_json text,
    supplied_screened_json text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare draft jsonb; screened jsonb; snapshot jsonb; proposed jsonb;
    theme jsonb; quote jsonb; source jsonb; reviewed jsonb;
    review internal.gate3_analyst_review_receipts%rowtype;
    ordinal integer := 0; supporters integer; prior uuid;
    draft_hash text; screened_hash text;
begin
    if supplied_study_id is null or supplied_reviewer_receipt_id is null
        or supplied_binding_digest !~ '^[a-f0-9]{64}$'
        or supplied_draft_json is null or supplied_screened_json is null
        or octet_length(convert_to(supplied_draft_json, 'UTF8')) > 1048576
        or octet_length(convert_to(supplied_screened_json, 'UTF8')) > 1048576
    then return null; end if;
    draft := supplied_draft_json::jsonb;
    screened := supplied_screened_json::jsonb;
    if jsonb_typeof(draft) <> 'object'
        or jsonb_typeof(screened) <> 'object'
        or not (draft ?& array['output','model','promptVersion',
            'promptDigest','studyId','sources','mapEvidence'])
        or not (screened ?& array['themes','decisions'])
        or (select count(*) from jsonb_object_keys(screened)) <> 2
        or draft ->> 'studyId' is distinct from supplied_study_id::text
        or draft -> 'output' ->> 'version' <> '2'
        or jsonb_typeof(draft -> 'sources') <> 'array'
        or jsonb_typeof(draft -> 'output' -> 'themes') <> 'array'
        or jsonb_typeof(screened -> 'themes') <> 'array'
        or jsonb_typeof(screened -> 'decisions') <> 'array'
        or jsonb_array_length(screened -> 'themes') = 0
        or jsonb_array_length(screened -> 'themes') <>
            jsonb_array_length(draft -> 'output' -> 'themes')
        or jsonb_array_length(screened -> 'decisions') = 0
        or exists (select 1 from jsonb_array_elements(screened -> 'decisions')
            as decision(item) where item ->> 'action' <> 'accept')
    then return null; end if;
    select * into review from internal.gate3_analyst_review_receipts
        where id = supplied_reviewer_receipt_id
            and study_id = supplied_study_id;
    if not found then return null; end if;
    -- Refuse an in-flight source or consent write; the receipt must describe
    -- one current snapshot, not a read that races a re-redaction.
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
        in share mode nowait;
    snapshot := public.read_gate3_analyst_snapshot(
        supplied_study_id, review.quote_id, review.actor_auth_user_id,
        draft ->> 'model', draft ->> 'promptVersion',
        draft ->> 'promptDigest');
    if snapshot is null
        or jsonb_array_length(draft -> 'sources') <>
            jsonb_array_length(snapshot -> 'sources')
        or (select count(distinct proposed_source.item ->> 'transcriptId')
            from jsonb_array_elements(draft -> 'sources')
                as proposed_source(item)) <>
            jsonb_array_length(snapshot -> 'sources')
        or exists (select 1 from jsonb_array_elements(draft -> 'sources')
            as proposed_source(item) where not exists (
                select 1 from jsonb_array_elements(snapshot -> 'sources')
                    as current_source(item)
                where current_source.item ->> 'transcriptId' =
                    proposed_source.item ->> 'transcriptId'
                    and current_source.item ->> 'sourceVersion' =
                        proposed_source.item ->> 'sourceVersion'
                    and current_source.item ->> 'questionId' =
                        proposed_source.item ->> 'questionId'
                    and current_source.item -> 'receipt'
                        ->> 'redactedTextDigest' =
                        proposed_source.item ->> 'redactedDigest'
                    and current_source.item ->> 'policyDigest' =
                        proposed_source.item ->> 'policyDigest'
                    and current_source.item ->> 'qualificationDigest' =
                        proposed_source.item ->> 'qualificationDigest'))
    then return null; end if;
    for theme in select value from jsonb_array_elements(screened -> 'themes')
    loop
        ordinal := ordinal + 1;
        proposed := draft -> 'output' -> 'themes' -> (ordinal - 1);
        if theme ->> 'position' <> ordinal::text
            or jsonb_typeof(theme -> 'supportingQuotes') <> 'array'
            or jsonb_typeof(theme -> 'contradictingQuotes') <> 'array'
            or jsonb_array_length(theme -> 'supportingQuotes') = 0
            or proposed ->> 'total' <>
                jsonb_array_length(snapshot -> 'approvedSessions')::text
        then return null; end if;
        for quote in select value from jsonb_array_elements(
            (theme -> 'supportingQuotes') || (theme -> 'contradictingQuotes'))
        loop
            if quote ->> 'studyId' <> supplied_study_id::text
                or (quote ->> 'startChar')::integer < 0
                or (quote ->> 'endChar')::integer <=
                    (quote ->> 'startChar')::integer
                or (quote ->> 'confidence')::numeric not between 0 and 1
            then return null; end if;
            select current.item into source
                from jsonb_array_elements(snapshot -> 'sources')
                    as current(item)
                where current.item ->> 'transcriptId' =
                    quote ->> 'transcriptId'
                    and current.item ->> 'sourceVersion' =
                        quote ->> 'sourceVersion';
            if source is null or substr(source ->> 'redactedText',
                (quote ->> 'startChar')::integer + 1,
                (quote ->> 'endChar')::integer -
                    (quote ->> 'startChar')::integer)
                    is distinct from quote ->> 'exactText'
                or not exists (select 1 from jsonb_array_elements(
                    (proposed -> 'supportingQuotes')
                    || (proposed -> 'contradictingQuotes')) as candidate(item)
                    where candidate.item - 'rationale' = quote
                        and nullif(btrim(candidate.item ->> 'rationale'), '')
                            is not null)
            then return null; end if;
        end loop;
        select count(distinct current.item ->> 'respondentId')
            into supporters
            from jsonb_array_elements(theme -> 'supportingQuotes')
                as support(item)
            join jsonb_array_elements(snapshot -> 'sources') as current(item)
                on current.item ->> 'transcriptId' =
                    support.item ->> 'transcriptId'
                and current.item ->> 'sourceVersion' =
                    support.item ->> 'sourceVersion';
        if proposed ->> 'count' <> supporters::text
        then return null; end if;
    end loop;
    draft_hash := encode(pg_catalog.sha256(
        convert_to(supplied_draft_json, 'UTF8')), 'hex');
    screened_hash := encode(pg_catalog.sha256(
        convert_to(supplied_screened_json, 'UTF8')), 'hex');
    insert into internal.gate3_analysis_output_receipts (
        study_id, reviewer_receipt_id, binding_digest,
        draft_digest, screened_digest)
    values (supplied_study_id, supplied_reviewer_receipt_id,
        supplied_binding_digest, draft_hash, screened_hash)
    on conflict (study_id, reviewer_receipt_id, binding_digest,
        draft_digest, screened_digest) do nothing;
    select id into prior from internal.gate3_analysis_output_receipts
        where study_id = supplied_study_id
            and reviewer_receipt_id = supplied_reviewer_receipt_id
            and binding_digest = supplied_binding_digest
            and draft_digest = draft_hash
            and screened_digest = screened_hash;
    return prior;
exception when invalid_text_representation or numeric_value_out_of_range
    or invalid_parameter_value or lock_not_available then return null;
end;
$$;
revoke all on function public.attest_gate3_private_analysis_output(
    uuid, uuid, text, text, text) from public, anon, authenticated,
    service_role;
grant execute on function public.attest_gate3_private_analysis_output(
    uuid, uuid, text, text, text) to gate3_analysis_validator;
