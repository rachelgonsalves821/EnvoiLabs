-- Restricted Gate 1 qualification handoff for screening. The local redactor
-- runs outside SQL; this transaction binds its result to the exact current
-- private answer, active policy and immutable source version.
alter table internal.gate2_screening_redacted_sources
    add column idempotency_key text unique;

create function public.read_gate2_screening_redaction_input(
    requested_answer_id uuid, requested_policy_digest text
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('answerId', answer.id,
        'studyId', answer.study_id, 'kind', answer.kind,
        'answerText', answer.answer_text,
        'rawAnswerDigest', encode(pg_catalog.sha256(
            convert_to(answer.answer_text, 'UTF8')), 'hex'),
        'policyDigest', policy.policy_digest,
        'qualificationDigest', policy.qualification_digest)
    from pii.gate2_screener_answers as answer
    join public.invites as offer on offer.id = answer.invite_id
        and offer.study_id = answer.study_id
    join public.studies as study on study.id = answer.study_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join internal.gate1_redaction_policies as policy
        on policy.policy_digest = requested_policy_digest
        and policy.revoked_at is null
    where answer.id = requested_answer_id
        and study.state = 'fielding' and offer.state = 'screening'
        and offer.expires_at > clock_timestamp()
        and respondent.status = 'active'
        and internal.gate1_consent(respondent.id, study.id, 'retention')
        and public.get_gate2_screening_rule(answer.rule_id,
            answer.study_id, answer.rule_version) is not null
        and (answer.kind = 'text' or
            internal.gate2_screening_transcript_current(answer.transcription_receipt_id));
$$;
revoke all on function public.read_gate2_screening_redaction_input(uuid,text)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_screening_redaction_input(uuid,text)
    to service_role;

create function public.publish_gate2_screening_redacted_source(
    requested_answer_id uuid, requested_policy_digest text,
    requested_raw_digest text, requested_redacted_text text,
    requested_redaction_passed boolean, requested_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    answer pii.gate2_screener_answers%rowtype;
    offer public.invites%rowtype;
    policy internal.gate1_redaction_policies%rowtype;
    prior internal.gate2_screening_redacted_sources%rowtype;
    published internal.gate2_screening_redacted_sources%rowtype;
    current_digest text;
    qualified boolean;
    safe_text text;
begin
    if requested_key is null or requested_key !~ '^gate2-redaction:[a-f0-9-]{36}$'
        or requested_raw_digest is null or requested_raw_digest !~ '^[a-f0-9]{64}$'
        or requested_redaction_passed is null
        or length(requested_redacted_text) > 2000
    then raise invalid_parameter_value; end if;
    select * into answer from pii.gate2_screener_answers
        where id = requested_answer_id;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.studies where id = answer.study_id
        and state = 'fielding' for update;
    if not found then raise check_violation; end if;
    select * into offer from public.invites where id = answer.invite_id;
    perform 1 from public.respondents where id = offer.respondent_id
        and status = 'active' for update;
    if not found then raise check_violation; end if;
    select * into offer from public.invites where id = answer.invite_id for update;
    if not found or offer.state <> 'screening'
        or offer.expires_at <= clock_timestamp()
        or not internal.gate1_consent(offer.respondent_id, answer.study_id, 'retention')
        or public.get_gate2_screening_rule(answer.rule_id,
            answer.study_id, answer.rule_version) is null
        or (answer.kind = 'voice' and not
            internal.gate2_screening_transcript_current(answer.transcription_receipt_id))
    then raise check_violation; end if;
    select * into policy from internal.gate1_redaction_policies
        where policy_digest = requested_policy_digest and revoked_at is null for share;
    if not found then raise check_violation; end if;
    current_digest := encode(pg_catalog.sha256(
        convert_to(answer.answer_text, 'UTF8')), 'hex');
    if requested_raw_digest <> current_digest then raise check_violation; end if;
    qualified := requested_redaction_passed and
        coalesce(nullif(btrim(requested_redacted_text), '') is not null, false);
    safe_text := case when qualified then requested_redacted_text else null end;
    select * into prior from internal.gate2_screening_redacted_sources
        where idempotency_key = requested_key;
    if found then
        if prior.answer_id <> answer.id or prior.raw_answer_digest <> current_digest
            or prior.redaction_policy_digest <> policy.policy_digest
            or prior.qualification_digest <> policy.qualification_digest
            or prior.qualified <> qualified
            or prior.redacted_text is distinct from safe_text
        then raise unique_violation; end if;
        return jsonb_build_object('sourceVersion', prior.source_version,
            'qualified', prior.qualified);
    end if;
    insert into internal.gate2_screening_redacted_sources
        (answer_id, raw_answer_digest, redacted_text,
        redaction_policy_digest, qualification_digest, qualified, idempotency_key)
    values (answer.id, current_digest, safe_text,
        policy.policy_digest, policy.qualification_digest, qualified, requested_key)
    returning * into published;
    return jsonb_build_object('sourceVersion', published.source_version,
        'qualified', published.qualified);
end;
$$;
revoke all on function public.publish_gate2_screening_redacted_source(
    uuid,text,text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.publish_gate2_screening_redacted_source(
    uuid,text,text,text,boolean,text) to service_role;
