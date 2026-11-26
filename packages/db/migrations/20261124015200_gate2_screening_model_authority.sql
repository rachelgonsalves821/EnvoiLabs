-- Purpose-specific model authority is dormant until an approved policy and
-- study-specific consent receipt are recorded. Existing onboarding grants none.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
    'recording', 'transcription_vendor', 'retention', 'researcher_access',
    'voice_clip_sharing', 'push_notifications', 'ai_followup', 'ai_screening'
));
alter table public.consents add constraint gate2_ai_screening_requires_study
    check (purpose <> 'ai_screening' or study_id is not null);

create table internal.gate2_screening_model_policies (
    id uuid primary key default gen_random_uuid(),
    provider_model text not null check (btrim(provider_model) <> ''),
    prompt_version text not null check (btrim(prompt_version) <> ''),
    prompt_digest text not null check (prompt_digest ~ '^[a-f0-9]{64}$'),
    consent_text_version text not null check (btrim(consent_text_version) <> ''),
    consent_text_digest text not null check (consent_text_digest ~ '^[a-f0-9]{64}$'),
    approved_at timestamptz not null,
    revoked_at timestamptz,
    unique (provider_model, prompt_version, prompt_digest),
    check (revoked_at is null or revoked_at >= approved_at)
);
create table internal.gate2_screening_consent_receipts (
    consent_id uuid primary key references public.consents (id) on delete cascade,
    text_digest text not null check (text_digest ~ '^[a-f0-9]{64}$'),
    recorded_at timestamptz not null default clock_timestamp()
);
alter table internal.gate2_screening_model_policies enable row level security;
alter table internal.gate2_screening_consent_receipts enable row level security;
revoke all on internal.gate2_screening_model_policies,
    internal.gate2_screening_consent_receipts
    from public, anon, authenticated, service_role;

-- Gate 1 qualification must publish a new immutable identity for every
-- screening redaction. The latest row wins, including a withheld row; an
-- older qualified text can never become current again by fallback.
create table internal.gate2_screening_redacted_sources (
    sequence bigint generated always as identity primary key,
    answer_id uuid not null references pii.gate2_screener_answers (id),
    source_version uuid not null default gen_random_uuid() unique,
    raw_answer_digest text not null check (raw_answer_digest ~ '^[a-f0-9]{64}$'),
    redacted_text text,
    redaction_policy_digest text not null check (redaction_policy_digest ~ '^[a-f0-9]{64}$'),
    qualification_digest text not null check (qualification_digest ~ '^[a-f0-9]{64}$'),
    qualified boolean not null,
    created_at timestamptz not null default clock_timestamp(),
    check (not qualified or nullif(btrim(redacted_text), '') is not null)
);
create index gate2_screening_redacted_sources_latest
    on internal.gate2_screening_redacted_sources (answer_id, sequence desc);
alter table internal.gate2_screening_redacted_sources enable row level security;
revoke all on internal.gate2_screening_redacted_sources
    from public, anon, authenticated, service_role;

create function public.current_gate2_screening_model_source(
    requested_study_id uuid, requested_answer_id uuid, requested_rule_id uuid,
    requested_rule_version integer, requested_provider_model text,
    requested_prompt_version text, requested_prompt_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('studyId', answer.study_id,
        'answerId', answer.id, 'ruleId', rule.id,
        'ruleVersion', rule.version, 'criterionText', rule.criterion_text,
        'question', rule.question, 'answerText', source.redacted_text,
        'redactedSourceVersion', source.source_version,
        'redactionPolicyDigest', source.redaction_policy_digest)
    from pii.gate2_screener_answers as answer
    join public.invites as offer on offer.id = answer.invite_id
        and offer.study_id = answer.study_id
    join public.studies as study on study.id = answer.study_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join public.gate2_screening_rules as rule on rule.id = answer.rule_id
        and rule.study_id = answer.study_id and rule.version = answer.rule_version
    join lateral (
        select latest.* from internal.gate2_screening_redacted_sources as latest
        where latest.answer_id = answer.id
        order by latest.sequence desc limit 1
    ) as source on source.qualified
        and source.raw_answer_digest = encode(
            pg_catalog.sha256(convert_to(answer.answer_text, 'UTF8')), 'hex')
    join internal.gate1_redaction_policies as redaction_policy
        on redaction_policy.policy_digest = source.redaction_policy_digest
        and redaction_policy.qualification_digest = source.qualification_digest
        and redaction_policy.revoked_at is null
    join lateral (
        select consent.* from public.consents as consent
        where consent.respondent_id = offer.respondent_id
            and consent.study_id = answer.study_id
            and consent.purpose = 'ai_screening'
        order by consent.created_at desc, consent.recorded_sequence desc limit 1
    ) as consent on consent.granted
    join internal.gate2_screening_consent_receipts as receipt
        on receipt.consent_id = consent.id
    join internal.gate2_screening_model_policies as policy
        on policy.consent_text_version = consent.text_version
        and policy.consent_text_digest = receipt.text_digest
        and policy.provider_model = requested_provider_model
        and policy.prompt_version = requested_prompt_version
        and policy.prompt_digest = requested_prompt_digest
        and policy.approved_at <= now() and policy.revoked_at is null
    where answer.id = requested_answer_id
        and answer.study_id = requested_study_id
        and answer.rule_id = requested_rule_id
        and answer.rule_version = requested_rule_version
        and study.state = 'fielding' and offer.state = 'screening'
        and offer.expires_at > now() and respondent.status = 'active'
        and rule.approved_at <= now()
        and public.get_gate2_screening_rule(rule.id, rule.study_id, rule.version) is not null
        and internal.gate1_consent(respondent.id, study.id, 'retention')
        and (answer.kind = 'text' or (
            internal.gate1_voice_allowed(respondent.id, study.id)
            and answer.transcription_consent_version = (
                select current_consent.text_version from public.consents as current_consent
                where current_consent.respondent_id = respondent.id
                    and (current_consent.study_id = study.id or current_consent.study_id is null)
                    and current_consent.purpose = 'transcription_vendor'
                order by (current_consent.study_id is not null) desc,
                    current_consent.created_at desc,
                    current_consent.recorded_sequence desc limit 1)))
        and not exists (select 1 from public.gate2_screening_events as decision
            where decision.answer_id = answer.id);
$$;
revoke all on function public.current_gate2_screening_model_source(
    uuid, uuid, uuid, integer, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.current_gate2_screening_model_source(
    uuid, uuid, uuid, integer, text, text, text) to service_role;
