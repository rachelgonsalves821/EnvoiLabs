-- A committed model decision still needs its current qualified source for
-- idempotent retries; the model-use callback blocks a second model call.
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

alter table public.gate2_screening_events
    add column redacted_source_version uuid,
    add column redaction_policy_digest text check (
        redaction_policy_digest ~ '^[a-f0-9]{64}$'),
    add column provider_model text,
    add column prompt_version text,
    add column prompt_digest text check (prompt_digest ~ '^[a-f0-9]{64}$'),
    add constraint gate2_model_decision_source_complete check (
        (redacted_source_version is null and redaction_policy_digest is null
            and provider_model is null and prompt_version is null
            and prompt_digest is null)
        or (redacted_source_version is not null
            and redaction_policy_digest is not null
            and nullif(btrim(provider_model), '') is not null
            and nullif(btrim(prompt_version), '') is not null
            and prompt_digest is not null));

-- Publication, consent and rule writes use the same study/respondent lock
-- order as decision commit. No new receipt or withdrawal may slip between
-- the current-source check and the invite transition.
create function internal.gate2_lock_screening_source_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    answer pii.gate2_screener_answers%rowtype;
    respondent_id uuid;
begin
    select * into answer from pii.gate2_screener_answers
        where id = new.answer_id;
    if not found then raise foreign_key_violation; end if;
    select offer.respondent_id into respondent_id from public.invites as offer
        where offer.id = answer.invite_id;
    perform 1 from public.studies where id = answer.study_id for update;
    perform 1 from public.respondents where id = respondent_id for update;
    return new;
end;
$$;
revoke all on function internal.gate2_lock_screening_source_write()
    from public, anon, authenticated, service_role;
create trigger gate2_lock_screening_source_write
    before insert on internal.gate2_screening_redacted_sources
    for each row execute function internal.gate2_lock_screening_source_write();

create function internal.gate2_lock_screening_consent_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.purpose in ('ai_screening', 'retention', 'transcription_vendor') then
        if new.study_id is not null then
            perform 1 from public.studies where id = new.study_id for update;
        end if;
        perform 1 from public.respondents
            where id = new.respondent_id for update;
    end if;
    return new;
end;
$$;
revoke all on function internal.gate2_lock_screening_consent_write()
    from public, anon, authenticated, service_role;
create trigger gate2_lock_screening_consent_write
    before insert or update on public.consents
    for each row execute function internal.gate2_lock_screening_consent_write();

create function internal.gate2_lock_screening_rule_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    perform 1 from public.studies where id = new.study_id for update;
    return new;
end;
$$;
revoke all on function internal.gate2_lock_screening_rule_write()
    from public, anon, authenticated, service_role;
create trigger gate2_lock_screening_rule_write
    before insert on public.gate2_screening_rules
    for each row execute function internal.gate2_lock_screening_rule_write();

create or replace function internal.check_gate2_screening_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    source_text text;
    rule_kind text;
    answer pii.gate2_screener_answers%rowtype;
    qualified_source jsonb;
begin
    select * into answer from pii.gate2_screener_answers where id = new.answer_id;
    if new.redacted_source_version is null then
        source_text := answer.answer_text;
    else
        qualified_source := public.current_gate2_screening_model_source(
            answer.study_id, answer.id, new.rule_id, new.rule_version,
            new.provider_model, new.prompt_version, new.prompt_digest);
        if qualified_source is null
            or qualified_source ->> 'redactedSourceVersion'
                is distinct from new.redacted_source_version::text
            or qualified_source ->> 'redactionPolicyDigest'
                is distinct from new.redaction_policy_digest
        then raise check_violation; end if;
        source_text := qualified_source ->> 'answerText';
    end if;
    select criterion_kind into rule_kind from public.gate2_screening_rules
        where id = new.rule_id;
    if source_text is null or rule_kind is null then raise foreign_key_violation; end if;
    if new.start_char is not null and (new.end_char >
        char_length(source_text) or btrim(substr(source_text,
            new.start_char + 1, new.end_char - new.start_char)) = '')
    then raise check_violation; end if;
    if new.action in ('qualify', 'screen_out') then
        if new.confirmed_fact is distinct from (new.interpretation = 'supported')
        then raise check_violation; end if;
        if (new.action = 'screen_out') is distinct from
            ((rule_kind = 'must' and new.interpretation = 'contradicted') or
             (rule_kind = 'exclude' and new.interpretation = 'supported'))
        then raise check_violation; end if;
    end if;
    return new;
end;
$$;

create function public.commit_gate2_qualified_screening_decision(
    requested_answer_id uuid, requested_rule_id uuid, requested_version integer,
    requested_interpretation text, requested_start integer, requested_end integer,
    requested_action text, requested_confirmed boolean,
    requested_source_version uuid, requested_redaction_policy_digest text,
    requested_provider_model text, requested_prompt_version text,
    requested_prompt_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    source pii.gate2_screener_answers%rowtype;
    target public.invites%rowtype;
    study public.studies%rowtype;
    prior public.gate2_screening_events%rowtype;
    saved public.gate2_screening_events%rowtype;
    active_count integer;
    cohort_label jsonb;
    current_voice_version text;
    qualified_source jsonb;
begin
    select * into source from pii.gate2_screener_answers where id = requested_answer_id;
    if not found then raise insufficient_privilege; end if;
    select * into study from public.studies where id = source.study_id for update;
    perform 1 from public.respondents where id = (
        select respondent_id from public.invites where id = source.invite_id) for update;
    select * into target from public.invites where id = source.invite_id for update;
    if not found or target.study_id <> source.study_id
        or source.rule_id <> requested_rule_id or source.rule_version <> requested_version
    then raise insufficient_privilege; end if;
    if requested_source_version is null
        or requested_redaction_policy_digest !~ '^[a-f0-9]{64}$'
        or requested_prompt_digest !~ '^[a-f0-9]{64}$'
        or nullif(btrim(requested_provider_model), '') is null
        or nullif(btrim(requested_prompt_version), '') is null
    then raise check_violation; end if;
    -- Policy revocation waits until this decision transaction completes.
    perform 1 from internal.gate1_redaction_policies as policy
        where policy.policy_digest = requested_redaction_policy_digest
            and policy.revoked_at is null for share;
    if not found then raise check_violation; end if;
    perform 1 from internal.gate2_screening_model_policies as policy
        where policy.provider_model = requested_provider_model
            and policy.prompt_version = requested_prompt_version
            and policy.prompt_digest = requested_prompt_digest
            and policy.revoked_at is null for share;
    if not found then raise check_violation; end if;
    qualified_source := public.current_gate2_screening_model_source(
        source.study_id, source.id, requested_rule_id, requested_version,
        requested_provider_model, requested_prompt_version,
        requested_prompt_digest);
    if qualified_source is null
        or qualified_source ->> 'redactedSourceVersion'
            is distinct from requested_source_version::text
        or qualified_source ->> 'redactionPolicyDigest'
            is distinct from requested_redaction_policy_digest
    then raise check_violation; end if;
    select * into prior from public.gate2_screening_events
    where answer_id = requested_answer_id for update;
    if found then
        if prior.rule_id <> requested_rule_id or prior.rule_version <> requested_version
            or prior.interpretation is distinct from requested_interpretation
            or prior.start_char is distinct from requested_start
            or prior.end_char is distinct from requested_end
            or prior.action <> requested_action
            or prior.confirmed_fact is distinct from requested_confirmed
            or prior.redacted_source_version is distinct from requested_source_version
            or prior.redaction_policy_digest is distinct from requested_redaction_policy_digest
            or prior.provider_model is distinct from requested_provider_model
            or prior.prompt_version is distinct from requested_prompt_version
            or prior.prompt_digest is distinct from requested_prompt_digest
        then raise unique_violation; end if;
        return internal.gate2_screening_event_json(prior) || jsonb_build_object(
            'redactedSourceVersion', prior.redacted_source_version,
            'redactionPolicyDigest', prior.redaction_policy_digest);
    end if;
    if study.state <> 'fielding' or target.state <> 'screening'
        or target.expires_at <= clock_timestamp()
        or not exists (select 1 from public.respondents
            where id = target.respondent_id and status = 'active')
        or public.get_gate2_screening_rule(
            requested_rule_id, source.study_id, requested_version) is null
        or not internal.gate1_consent(target.respondent_id, source.study_id, 'retention')
    then raise check_violation; end if;
    if source.kind = 'voice' then
        select text_version into current_voice_version from public.consents
        where respondent_id = target.respondent_id
            and (study_id = source.study_id or study_id is null)
            and purpose = 'transcription_vendor' and granted
        order by (study_id is not null) desc, created_at desc, recorded_sequence desc limit 1;
        if not internal.gate1_voice_allowed(target.respondent_id, source.study_id)
            or current_voice_version is distinct from source.transcription_consent_version
        then raise check_violation; end if;
    end if;
    -- The invite cannot enter an eligible state while another live offer or
    -- a recent participation occupies the respondent's capacity.
    if requested_action = 'qualify' then
        select count(*) into active_count from public.invites as offer
        where offer.respondent_id = target.respondent_id and offer.id <> target.id
            and offer.expires_at > clock_timestamp()
            and offer.state in ('matched', 'screening', 'invited', 'accepted');
        cohort_label := study.labels;
        if active_count > 0
            or (select count(*) from public.sessions as session
                join public.invites as offer on offer.id = session.invite_id
                where offer.respondent_id = target.respondent_id
                    and session.submitted_at > clock_timestamp() - interval '7 days') >= 3
            or (cohort_label <> '[]'::jsonb and exists (
                select 1 from public.sessions as session
                join public.invites as offer on offer.id = session.invite_id
                join public.studies as prior_study on prior_study.id = session.study_id
                where offer.respondent_id = target.respondent_id
                    and prior_study.id <> study.id and prior_study.labels @> cohort_label
                    and session.submitted_at > clock_timestamp() - interval '30 days'))
        then raise check_violation; end if;
    end if;
    insert into public.gate2_screening_events (answer_id, rule_id, rule_version,
        interpretation, start_char, end_char, action, confirmed_fact,
        redacted_source_version, redaction_policy_digest,
        provider_model, prompt_version, prompt_digest)
    values (requested_answer_id, requested_rule_id, requested_version,
        requested_interpretation, requested_start, requested_end,
        requested_action, requested_confirmed, requested_source_version,
        requested_redaction_policy_digest, requested_provider_model,
        requested_prompt_version, requested_prompt_digest) returning * into saved;
    if requested_action = 'screen_out' then
        update public.invites set state = 'screened_out' where id = target.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('invite', target.id, 'screening', 'screened_out', 'platform');
    elsif requested_action = 'qualify' and not exists (
        select 1 from public.gate2_screening_rules as rule
        where rule.study_id = source.study_id and rule.approved_at <= now()
            and not exists (select 1 from public.gate2_screening_rules as newer
                where newer.criterion_id = rule.criterion_id and newer.version > rule.version
                    and newer.approved_at <= now())
            and not exists (select 1 from public.gate2_screening_events as event
                join pii.gate2_screener_answers as answer on answer.id = event.answer_id
                where answer.invite_id = target.id and event.rule_id = rule.id
                    and event.rule_version = rule.version and event.action = 'qualify')
    ) then
        update public.invites set state = 'invited' where id = target.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('invite', target.id, 'screening', 'invited', 'platform');
    end if;
    return internal.gate2_screening_event_json(saved) || jsonb_build_object(
        'redactedSourceVersion', saved.redacted_source_version,
        'redactionPolicyDigest', saved.redaction_policy_digest);
end;
$$;
revoke all on function public.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) to service_role;

-- Retry readers see only the committed result while its source and purpose
-- are still current. A withdrawn or re-redacted answer has no prior fallback.
create function public.get_gate2_current_qualified_screening_decision(
    requested_answer_id uuid, requested_provider_model text,
    requested_prompt_version text, requested_prompt_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
    select internal.gate2_screening_event_json(event) || jsonb_build_object(
        'redactedSourceVersion', event.redacted_source_version,
        'redactionPolicyDigest', event.redaction_policy_digest)
    from public.gate2_screening_events as event
    join pii.gate2_screener_answers as answer on answer.id = event.answer_id
    cross join lateral (select public.current_gate2_screening_model_source(
        answer.study_id, answer.id, event.rule_id, event.rule_version,
        requested_provider_model, requested_prompt_version,
        requested_prompt_digest) as value) as current_source
    where event.answer_id = requested_answer_id
        and event.redacted_source_version is not null
        and event.provider_model = requested_provider_model
        and event.prompt_version = requested_prompt_version
        and event.prompt_digest = requested_prompt_digest
        and current_source.value ->> 'redactedSourceVersion'
            = event.redacted_source_version::text
        and current_source.value ->> 'redactionPolicyDigest'
            = event.redaction_policy_digest;
$$;
revoke all on function public.get_gate2_current_qualified_screening_decision(
    uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_gate2_current_qualified_screening_decision(
    uuid, text, text, text) to service_role;
