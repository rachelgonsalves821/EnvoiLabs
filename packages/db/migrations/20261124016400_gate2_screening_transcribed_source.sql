-- A voice screening answer must be copied from a private transcription receipt.
-- The upload/worker path that creates these receipts remains a separate,
-- default-off slice. A service caller cannot label supplied text as voice.
create table pii.gate2_screening_transcription_receipts (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null,
    study_id uuid not null,
    respondent_id uuid not null references public.respondents (id),
    rule_id uuid not null,
    rule_version integer not null,
    audio_object_id uuid not null unique,
    audio_storage_path text not null,
    audio_bytes integer not null check (audio_bytes between 1 and 20971520),
    audio_mime text not null check (audio_mime in
        ('audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg')),
    duration_ms integer not null check (duration_ms between 1 and 180000),
    audio_sha256 text not null check (audio_sha256 ~ '^[a-f0-9]{64}$'),
    provider text not null check (btrim(provider) <> ''),
    model text not null check (btrim(model) <> ''),
    transcript_text text not null check (btrim(transcript_text) <> ''),
    recording_consent_id uuid not null references public.consents (id),
    transcription_consent_id uuid not null references public.consents (id),
    transcription_consent_version text not null,
    created_at timestamptz not null default clock_timestamp(),
    foreign key (invite_id, study_id) references public.invites (id, study_id),
    foreign key (rule_id, study_id, rule_version)
        references public.gate2_screening_rules (id, study_id, version),
    check (audio_storage_path = 'screening/' || invite_id || '/' || audio_object_id)
);
alter table pii.gate2_screening_transcription_receipts enable row level security;
revoke all on pii.gate2_screening_transcription_receipts
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_screening_transcription
    before update or delete on pii.gate2_screening_transcription_receipts
    for each row execute function internal.reject_gate2_ledger_mutation();

alter table pii.gate2_screener_answers
    add column transcription_receipt_id uuid unique references
        pii.gate2_screening_transcription_receipts (id);

create function internal.gate2_screening_transcript_current(
    supplied_receipt_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (select 1 from pii.gate2_screening_transcription_receipts as source
        join public.respondents as respondent on respondent.id = source.respondent_id
        join public.invites as offer on offer.id = source.invite_id
            and offer.respondent_id = source.respondent_id
            and offer.study_id = source.study_id
        join public.consents as recording on recording.id = source.recording_consent_id
            and recording.respondent_id = source.respondent_id
            and recording.purpose = 'recording' and recording.granted
            and (recording.study_id = source.study_id or recording.study_id is null)
        join public.consents as transcription on transcription.id = source.transcription_consent_id
            and transcription.respondent_id = source.respondent_id
            and transcription.purpose = 'transcription_vendor' and transcription.granted
            and (transcription.study_id = source.study_id or transcription.study_id is null)
            and transcription.text_version = source.transcription_consent_version
        where source.id = supplied_receipt_id
            and respondent.status = 'active'
            and internal.gate1_consent(source.respondent_id, source.study_id, 'retention')
            and internal.gate1_voice_allowed(source.respondent_id, source.study_id)
            and recording.id = (select current_recording.id from public.consents as current_recording
                where current_recording.respondent_id = source.respondent_id
                    and (current_recording.study_id = source.study_id or current_recording.study_id is null)
                    and current_recording.purpose = 'recording'
                order by (current_recording.study_id is not null) desc,
                    current_recording.created_at desc, current_recording.recorded_sequence desc limit 1)
            and transcription.id = (select current_transcription.id from public.consents as current_transcription
                where current_transcription.respondent_id = source.respondent_id
                    and (current_transcription.study_id = source.study_id or current_transcription.study_id is null)
                    and current_transcription.purpose = 'transcription_vendor'
                order by (current_transcription.study_id is not null) desc,
                    current_transcription.created_at desc, current_transcription.recorded_sequence desc limit 1));
$$;
revoke all on function internal.gate2_screening_transcript_current(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate2_guard_transcribed_screening_answer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source pii.gate2_screening_transcription_receipts%rowtype;
begin
    if new.kind <> 'voice' then
        if new.transcription_receipt_id is not null then raise check_violation; end if;
        return new;
    end if;
    select * into source from pii.gate2_screening_transcription_receipts
        where id = new.transcription_receipt_id;
    if not found or new.invite_id <> source.invite_id
        or new.study_id <> source.study_id or new.rule_id <> source.rule_id
        or new.rule_version <> source.rule_version
        or new.answer_text <> source.transcript_text
        or new.transcription_consent_version <> source.transcription_consent_version
        or not internal.gate2_screening_transcript_current(source.id)
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_transcribed_screening_answer()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_transcribed_screening_answer
    before insert on pii.gate2_screener_answers
    for each row execute function internal.gate2_guard_transcribed_screening_answer();

create function public.store_gate2_screening_transcribed_answer(
    requested_receipt_id uuid, requested_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare source pii.gate2_screening_transcription_receipts%rowtype;
declare prior pii.gate2_screener_answers%rowtype;
declare stored pii.gate2_screener_answers%rowtype;
declare offer public.invites%rowtype;
begin
    if nullif(btrim(requested_key), '') is null then raise check_violation; end if;
    select * into source from pii.gate2_screening_transcription_receipts
        where id = requested_receipt_id;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.studies where id = source.study_id for update;
    if not found then raise insufficient_privilege; end if;
    select * into prior from pii.gate2_screener_answers
        where idempotency_key = requested_key for update;
    if found then
        if prior.kind <> 'voice' or prior.transcription_receipt_id is distinct from source.id
            or not internal.gate2_screening_transcript_current(source.id)
        then raise unique_violation; end if;
        return internal.gate2_screening_answer_json(prior);
    end if;
    select * into offer from public.invites where id = source.invite_id for update;
    if not found or offer.state <> 'screening'
        or offer.expires_at <= clock_timestamp()
        or not exists (select 1 from public.studies
            where id = source.study_id and state = 'fielding')
        or public.get_gate2_screening_rule(source.rule_id,
            source.study_id, source.rule_version) is null
        or not internal.gate2_screening_transcript_current(source.id)
    then raise check_violation; end if;
    insert into pii.gate2_screener_answers (invite_id, study_id, rule_id,
        rule_version, kind, answer_text, transcription_consent_version,
        transcription_receipt_id, idempotency_key)
    values (source.invite_id, source.study_id, source.rule_id,
        source.rule_version, 'voice', source.transcript_text,
        source.transcription_consent_version, source.id, requested_key)
    returning * into stored;
    return internal.gate2_screening_answer_json(stored);
end;
$$;
revoke all on function public.store_gate2_screening_transcribed_answer(uuid,text)
    from public, anon, authenticated, service_role;
grant execute on function public.store_gate2_screening_transcribed_answer(uuid,text)
    to service_role;

create function internal.gate2_guard_transcribed_screening_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare voice_receipt uuid;
begin
    select answer.transcription_receipt_id into voice_receipt
    from pii.gate2_screener_answers as answer
    where answer.id = new.answer_id and answer.kind = 'voice';
    if found and (voice_receipt is null
        or not internal.gate2_screening_transcript_current(voice_receipt))
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_transcribed_screening_decision()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_transcribed_screening_decision
    before insert on public.gate2_screening_events
    for each row execute function internal.gate2_guard_transcribed_screening_decision();

create or replace function internal.gate2_screening_answer_json(answer pii.gate2_screener_answers)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object('id', answer.id, 'inviteId', answer.invite_id,
        'studyId', answer.study_id, 'ruleId', answer.rule_id,
        'ruleVersion', answer.rule_version, 'kind', answer.kind,
        'text', answer.answer_text,
        'transcriptionConsentVersion', answer.transcription_consent_version,
        'transcriptionReceiptId', answer.transcription_receipt_id,
        'idempotencyKey', answer.idempotency_key);
$$;
create or replace function public.current_gate2_screening_model_source(
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
        and study.state = 'fielding'
        and ((offer.state = 'screening' and offer.expires_at > now())
            or (offer.state in ('invited', 'screened_out')
                and exists (select 1 from public.gate2_screening_events as prior
                    where prior.answer_id = answer.id)))
        and respondent.status = 'active'
        and rule.approved_at <= now()
        and public.get_gate2_screening_rule(rule.id, rule.study_id, rule.version) is not null
        and internal.gate1_consent(respondent.id, study.id, 'retention')
        and (answer.kind <> 'voice' or internal.gate2_screening_transcript_current(answer.transcription_receipt_id))
        and (answer.kind = 'text' or (
            internal.gate1_voice_allowed(respondent.id, study.id)
            and answer.transcription_consent_version = (
                select current_consent.text_version from public.consents as current_consent
                where current_consent.respondent_id = respondent.id
                    and (current_consent.study_id = study.id or current_consent.study_id is null)
                    and current_consent.purpose = 'transcription_vendor'
                order by (current_consent.study_id is not null) desc,
                    current_consent.created_at desc,
                    current_consent.recorded_sequence desc limit 1)));
$$;
