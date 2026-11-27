-- The analyst model path has its own study-specific purpose. No preview or
-- onboarding flow grants it, and no model policy is active by default.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
    'recording', 'transcription_vendor', 'retention', 'researcher_access',
    'voice_clip_sharing', 'push_notifications', 'ai_followup', 'ai_screening',
    'ai_analysis'
));
alter table public.consents add constraint gate3_ai_analysis_requires_study
    check (purpose <> 'ai_analysis' or study_id is not null);

create table internal.gate3_analysis_model_policies (
    id uuid primary key default gen_random_uuid(),
    provider_model text not null check (btrim(provider_model) <> ''),
    prompt_version text not null check (btrim(prompt_version) <> ''),
    prompt_digest text not null check (prompt_digest ~ '^[a-f0-9]{64}$'),
    consent_text_version text not null check (btrim(consent_text_version) <> ''),
    consent_text_digest text not null check (consent_text_digest ~ '^[a-f0-9]{64}$'),
    approved_at timestamptz not null,
    revoked_at timestamptz,
    unique (provider_model, prompt_version, prompt_digest,
        consent_text_version, consent_text_digest),
    check (revoked_at is null or revoked_at >= approved_at)
);
create table internal.gate3_analysis_consent_receipts (
    consent_id uuid primary key references public.consents (id) on delete cascade,
    text_digest text not null check (text_digest ~ '^[a-f0-9]{64}$'),
    recorded_at timestamptz not null default clock_timestamp()
);
alter table internal.gate3_analysis_model_policies enable row level security;
alter table internal.gate3_analysis_consent_receipts enable row level security;
revoke all on internal.gate3_analysis_model_policies,
    internal.gate3_analysis_consent_receipts
    from public, anon, authenticated, service_role;

-- Capture the exact source identity after Gate 1's publication trigger has
-- rotated its UUID. Existing rows are deliberately not backfilled: a source
-- without this receipt must be requalified before it can reach a model.
create table internal.gate3_analysis_source_receipts (
    answer_id uuid not null,
    source_version uuid not null,
    redacted_text_digest text not null check (
        redacted_text_digest ~ '^[a-f0-9]{64}$'),
    source_hash bytea not null check (octet_length(source_hash) = 32),
    processing_revision bigint not null,
    publication_revision bigint not null,
    policy_digest text not null,
    qualification_digest text not null,
    captured_at timestamptz not null default clock_timestamp(),
    primary key (answer_id, source_version)
);
alter table internal.gate3_analysis_source_receipts enable row level security;
revoke all on internal.gate3_analysis_source_receipts
    from public, anon, authenticated, service_role;

create function internal.capture_gate3_analysis_source_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source public.transcripts%rowtype;
begin
    if new.result_status <> 'published' or not (
        old.result_status is distinct from new.result_status
        or old.source_hash is distinct from new.source_hash
        or old.processing_revision is distinct from new.processing_revision
        or old.publication_revision is distinct from new.publication_revision
        or old.publication_policy_digest is distinct from
            new.publication_policy_digest
        or old.publication_qualification_digest is distinct from
            new.publication_qualification_digest) then return null; end if;
    select * into source from public.transcripts
        where answer_id = new.answer_id;
    if source.id is null or nullif(btrim(source.redacted_text), '') is null
        or new.source_hash is null or new.processing_revision is null
        or new.publication_revision is null
        or not internal.gate3_policy_qualified(
            new.publication_policy_digest,
            new.publication_qualification_digest)
    then return null; end if;
    insert into internal.gate3_analysis_source_receipts (
        answer_id, source_version, redacted_text_digest,
        source_hash, processing_revision, publication_revision,
        policy_digest, qualification_digest)
    values (new.answer_id, source.redacted_source_version,
        encode(pg_catalog.sha256(convert_to(source.redacted_text,
            'UTF8')), 'hex'), new.source_hash,
        new.processing_revision, new.publication_revision,
        new.publication_policy_digest,
        new.publication_qualification_digest);
    return null;
end;
$$;
revoke all on function internal.capture_gate3_analysis_source_receipt()
    from public, anon, authenticated, service_role;
create trigger zz_capture_gate3_analysis_source_receipt
    after update on internal.gate1_answer_jobs for each row
    execute function internal.capture_gate3_analysis_source_receipt();

-- A later purpose decision cannot revive the exact source identity that a
-- previous grant authorized. Existing answers need a new Gate 1 qualified
-- publication before they can be analyzed under a later grant.
create function internal.rotate_gate3_analysis_source_on_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.purpose = 'ai_analysis' then
        update public.transcripts as source
            set redacted_source_version = gen_random_uuid()
        from public.answers as answer
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        where source.answer_id = answer.id
            and answer.study_id = new.study_id
            and offer.respondent_id = new.respondent_id;
    end if;
    return null;
end;
$$;
revoke all on function internal.rotate_gate3_analysis_source_on_consent()
    from public, anon, authenticated, service_role;
create trigger rotate_gate3_analysis_source_on_consent
    after insert on public.consents for each row
    execute function internal.rotate_gate3_analysis_source_on_consent();

-- A single statement recomputes the frozen brief/guide, paid quote, approved
-- cohort, every saved core answer, Gate 1 publication receipt, and the exact
-- current analysis grant before returning any redacted text to the server.
create function public.read_gate3_analyst_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid, supplied_provider_model text,
    supplied_prompt_version text, supplied_prompt_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
    with target as (
        select study.id as study_id, brief.brief_json,
            quote.id as quote_id, quote.guide_digest
        from public.studies as study
        join public.gate2_quote_snapshots as quote
            on quote.study_id = study.id and quote.id = supplied_quote_id
        join public.pricing_configs as config
            on config.id = quote.pricing_config_id
            and config.version = quote.pricing_config_version
        join public.brief_versions as brief on brief.study_id = study.id
            and brief.version = quote.brief_version
        where study.id = supplied_study_id
            and study.state in ('fielding', 'fieldwork_complete',
                'analyzing', 'report_ready')
            and study.target_completes >= 10
            and quote.pricing_config_version >= 101
            and config.params_json =
                '{"unitPriceCents":200,"incentivePerQuestionCents":100}'::jsonb
            and jsonb_array_length(quote.line_items_json) = 1
            and case when quote.line_items_json -> 0 ->> 'respondentCount'
                ~ '^[0-9]+$' then
                (quote.line_items_json -> 0 ->> 'respondentCount')::integer
                = study.target_completes else false end
            and quote.guide_digest = public.gate2_guide_digest(study.id)
            and quote.brief_version = (select max(version)
                from public.brief_versions where study_id = study.id)
            and exists (select 1 from public.researchers as researcher
                where researcher.organization_id = study.organization_id
                    and researcher.auth_user_id = supplied_researcher_auth_user_id)
            and exists (select 1 from public.gate2_payment_events as paid
                where paid.quote_id = quote.id and paid.study_id = study.id
                    and paid.event_kind = 'paid'
                    and paid.amount_cents = quote.total_cents
                    and paid.currency = quote.currency)
            and jsonb_typeof(brief.brief_json -> 'hypotheses') = 'array'
            and case when jsonb_typeof(brief.brief_json -> 'hypotheses')
                = 'array' then jsonb_array_length(
                    brief.brief_json -> 'hypotheses') >= 1
                else false end
            and nullif(btrim(brief.brief_json ->> 'decision'), '') is not null
    ), guide as (
        select count(*) as question_count, min(question.position) as first_position,
            max(question.position) as last_position,
            jsonb_agg(jsonb_build_object('id', question.id,
                'text', question.text) order by question.position) as questions
        from target join public.guide_questions as question
            on question.study_id = target.study_id
    ), approved as (
        select distinct on (offer.respondent_id)
            interview.id as session_id, offer.respondent_id
        from target
        join public.sessions as interview on interview.study_id = target.study_id
        join public.invites as offer on offer.id = interview.invite_id
            and offer.study_id = target.study_id and offer.state = 'accepted'
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.quality_scores as quality on quality.session_id = interview.id
            and quality.decision = 'approve'
        where interview.state in ('approved', 'paid')
            and interview.submitted_at is not null
            and respondent.status = 'active'
            and not exists (select 1 from public.removals as removal
                where removal.session_id = interview.id)
            and internal.gate1_consent(respondent.id, target.study_id,
                'retention')
            and internal.gate1_consent(respondent.id, target.study_id,
                'researcher_access')
        order by offer.respondent_id, interview.id
    ), core_answers as (
        select answer.id, answer.study_id, answer.guide_question_id,
            approved.respondent_id, approved.session_id
        from approved
        join public.answers as answer on answer.session_id = approved.session_id
            and answer.probe_id is null
        join public.guide_questions as question
            on question.id = answer.guide_question_id
            and question.study_id = answer.study_id
    ), qualified as (
        select answer.id as answer_id, answer.respondent_id,
            jsonb_build_object('studyId', answer.study_id,
                'transcriptId', source.id,
                'sourceVersion', source.redacted_source_version,
                'respondentId', answer.respondent_id,
                'sessionId', answer.session_id,
                'questionId', answer.guide_question_id,
                'redactedText', source.redacted_text,
                'policyDigest', job.publication_policy_digest,
                'qualificationDigest', job.publication_qualification_digest,
                'receipt', jsonb_build_object(
                    'sourceVersion', source_receipt.source_version,
                    'redactedTextDigest', source_receipt.redacted_text_digest,
                    'policyDigest', source_receipt.policy_digest,
                    'qualificationDigest', source_receipt.qualification_digest))
                as source_json,
            job.publication_policy_digest as policy_digest,
            job.publication_qualification_digest as qualification_digest
        from core_answers as answer
        join public.transcripts as source on source.answer_id = answer.id
            and source.study_id = answer.study_id
            and nullif(btrim(source.redacted_text), '') is not null
        join internal.gate1_answer_jobs as job on job.answer_id = answer.id
            and job.result_status = 'published'
        join internal.gate3_analysis_source_receipts as source_receipt
            on source_receipt.answer_id = answer.id
            and source_receipt.source_version =
                source.redacted_source_version
            and source_receipt.redacted_text_digest =
                encode(pg_catalog.sha256(convert_to(source.redacted_text,
                    'UTF8')), 'hex')
            and source_receipt.source_hash = job.source_hash
            and source_receipt.processing_revision = job.processing_revision
            and source_receipt.publication_revision = job.publication_revision
            and source_receipt.policy_digest = job.publication_policy_digest
            and source_receipt.qualification_digest =
                job.publication_qualification_digest
        join internal.gate1_redaction_policies as redaction
            on redaction.policy_digest = job.publication_policy_digest
            and redaction.qualification_digest =
                job.publication_qualification_digest
            and redaction.revoked_at is null
        join lateral (
            select current_grant.* from public.consents as current_grant
            where current_grant.respondent_id = answer.respondent_id
                and current_grant.study_id = answer.study_id
                and current_grant.purpose = 'ai_analysis'
            order by current_grant.created_at desc,
                current_grant.recorded_sequence desc limit 1
        ) as consent on consent.granted
        join internal.gate3_analysis_consent_receipts as receipt
            on receipt.consent_id = consent.id
        join internal.gate3_analysis_model_policies as model_policy
            on model_policy.provider_model = supplied_provider_model
            and model_policy.prompt_version = supplied_prompt_version
            and model_policy.prompt_digest = supplied_prompt_digest
            and model_policy.consent_text_version = consent.text_version
            and model_policy.consent_text_digest = receipt.text_digest
            and model_policy.approved_at <= now()
            and model_policy.revoked_at is null
        where internal.gate1_consent(answer.respondent_id,
                answer.study_id, 'ai_analysis')
            and exists (select 1
                from internal.gate1_processing_input(answer.id) as current_input
                where current_input.source_hash = job.source_hash
                    and current_input.processing_revision =
                        job.processing_revision
                    and current_input.publication_revision =
                        job.publication_revision)
    )
    select jsonb_build_object('studyId', target.study_id,
        'decisionQuestion', target.brief_json ->> 'decision',
        'hypotheses', target.brief_json -> 'hypotheses',
        'guideDigest', target.guide_digest,
        'approvedSessions', (select jsonb_agg(jsonb_build_object(
            'respondentId', respondent_id, 'sessionId', session_id)
            order by respondent_id) from approved),
        'guideQuestions', guide.questions,
        'sources', (select jsonb_agg(source_json order by answer_id)
            from qualified))
    from target cross join guide
    where guide.question_count between 4 and 10
        and guide.first_position = 1
        and guide.last_position = guide.question_count
        and (select count(*) from approved) >= 10
        and (select count(*) from core_answers) =
            (select count(*) from approved) * guide.question_count
        and (select count(distinct (session_id, guide_question_id))
            from core_answers) =
            (select count(*) from approved) * guide.question_count
        and (select count(*) from core_answers) =
            (select count(*) from qualified)
        and (select count(distinct respondent_id) from approved) =
            (select count(distinct respondent_id) from qualified)
        and (select count(distinct (policy_digest,
            qualification_digest)) from qualified) = 1;
$$;
revoke all on function public.read_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text) to service_role;

-- Gate 3 calls this again immediately before every map/reduce request and
-- before accepting output. Any changed grant, source, brief or guide denies.
create function public.authorize_gate3_analyst_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid, supplied_provider_model text,
    supplied_prompt_version text, supplied_prompt_digest text,
    supplied_snapshot jsonb
) returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce(supplied_snapshot is not null and supplied_snapshot =
        public.read_gate3_analyst_snapshot(supplied_study_id,
            supplied_quote_id, supplied_researcher_auth_user_id,
            supplied_provider_model, supplied_prompt_version,
            supplied_prompt_digest), false);
$$;
revoke all on function public.authorize_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.authorize_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text, jsonb) to service_role;
