-- The source wording, including its timeframe, is frozen with the exact
-- researcher-approved rule version. A question alone cannot define eligibility.
alter table public.gate2_screening_rules
    add column criterion_text text not null check (btrim(criterion_text) <> ''),
    add column timeframe_text text not null check (btrim(timeframe_text) <> '');

create function internal.check_gate2_rule_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare approved public.criteria%rowtype;
begin
    perform 1 from public.studies where id = new.study_id for update;
    select * into approved from public.criteria
    where id = new.criterion_id and study_id = new.study_id for share;
    if not found or new.criterion_kind <> approved.kind
        or new.criterion_text <> approved.text
        or position(lower(new.timeframe_text) in lower(new.criterion_text)) = 0
        or not exists (select 1 from public.researchers as researcher
            join public.studies as study on study.organization_id = researcher.organization_id
            where researcher.id = new.approved_by and study.id = new.study_id)
        or new.approved_at > clock_timestamp()
    then raise check_violation; end if;
    return new;
end;
$$;
create trigger check_gate2_rule_snapshot before insert on public.gate2_screening_rules
    for each row execute function internal.check_gate2_rule_snapshot();
revoke all on function internal.check_gate2_rule_snapshot()
    from public, anon, authenticated, service_role;

create function public.get_gate2_screening_rule(
    requested_rule_id uuid, requested_study_id uuid, requested_version integer
) returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('id', rule.id, 'studyId', rule.study_id,
        'criterionId', rule.criterion_id, 'version', rule.version,
        'criterionKind', rule.criterion_kind, 'criterionText', rule.criterion_text,
        'timeframeText', rule.timeframe_text, 'question', rule.question,
        'approvedAt', rule.approved_at)
    from public.gate2_screening_rules as rule
    where rule.id = requested_rule_id and rule.study_id = requested_study_id
        and rule.version = requested_version and rule.approved_at <= now()
        and not exists (select 1 from public.gate2_screening_rules as newer
            where newer.criterion_id = rule.criterion_id and newer.version > rule.version
                and newer.approved_at <= now());
$$;
revoke all on function public.get_gate2_screening_rule(uuid, uuid, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.get_gate2_screening_rule(uuid, uuid, integer) to service_role;

create function internal.gate2_screening_answer_json(answer pii.gate2_screener_answers)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object('id', answer.id, 'inviteId', answer.invite_id,
        'studyId', answer.study_id, 'ruleId', answer.rule_id,
        'ruleVersion', answer.rule_version, 'kind', answer.kind,
        'text', answer.answer_text,
        'transcriptionConsentVersion', answer.transcription_consent_version,
        'idempotencyKey', answer.idempotency_key);
$$;
revoke all on function internal.gate2_screening_answer_json(pii.gate2_screener_answers)
    from public, anon, authenticated, service_role;

create function public.store_gate2_screening_answer(
    requested_invite_id uuid, requested_respondent_id uuid, requested_study_id uuid,
    requested_rule_id uuid, requested_version integer, requested_kind text,
    requested_text text, requested_consent_version text, requested_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.invites%rowtype;
    previous pii.gate2_screener_answers%rowtype;
    stored pii.gate2_screener_answers%rowtype;
    latest_consent text;
begin
    if nullif(btrim(requested_key), '') is null
        or nullif(btrim(requested_text), '') is null
        or requested_kind not in ('text', 'voice')
    then raise check_violation; end if;
    perform 1 from public.studies where id = requested_study_id for update;
    if not found then raise insufficient_privilege; end if;
    select * into previous from pii.gate2_screener_answers
    where idempotency_key = requested_key for update;
    if found then
        if previous.invite_id <> requested_invite_id
            or not exists (select 1 from public.invites
                where id = previous.invite_id and respondent_id = requested_respondent_id)
            or previous.study_id <> requested_study_id
            or previous.rule_id <> requested_rule_id
            or previous.rule_version <> requested_version
            or previous.kind <> requested_kind
            or previous.answer_text <> requested_text
            or previous.transcription_consent_version is distinct from requested_consent_version
        then raise unique_violation; end if;
        if not exists (select 1 from public.respondents
                where id = requested_respondent_id and status = 'active')
            or not internal.gate1_consent(requested_respondent_id,
                requested_study_id, 'retention')
        then raise check_violation; end if;
        if previous.kind = 'voice' then
            select text_version into latest_consent from public.consents
            where respondent_id = requested_respondent_id
                and (study_id = requested_study_id or study_id is null)
                and purpose = 'transcription_vendor' and granted
            order by (study_id is not null) desc, created_at desc, recorded_sequence desc limit 1;
            if not internal.gate1_voice_allowed(requested_respondent_id, requested_study_id)
                or latest_consent is distinct from previous.transcription_consent_version
            then raise check_violation; end if;
        end if;
        return internal.gate2_screening_answer_json(previous);
    end if;
    select * into target from public.invites where id = requested_invite_id for update;
    if not found or target.study_id <> requested_study_id
        or target.respondent_id <> requested_respondent_id
        or target.state <> 'screening' or target.expires_at <= clock_timestamp()
        or not exists (select 1 from public.respondents
            where id = requested_respondent_id and status = 'active')
        or not exists (select 1 from public.studies
            where id = requested_study_id and state = 'fielding')
        or public.get_gate2_screening_rule(
            requested_rule_id, requested_study_id, requested_version) is null
        or not internal.gate1_consent(requested_respondent_id, requested_study_id, 'retention')
    then raise insufficient_privilege; end if;
    if requested_kind = 'voice' then
        select text_version into latest_consent from public.consents
        where respondent_id = requested_respondent_id
            and (study_id = requested_study_id or study_id is null)
            and purpose = 'transcription_vendor' and granted
        order by (study_id is not null) desc, created_at desc, recorded_sequence desc limit 1;
        if not internal.gate1_voice_allowed(requested_respondent_id, requested_study_id)
            or latest_consent is distinct from requested_consent_version
        then raise check_violation; end if;
    elsif requested_consent_version is not null then
        raise check_violation;
    end if;
    insert into pii.gate2_screener_answers (invite_id, study_id, rule_id,
        rule_version, kind, answer_text, transcription_consent_version, idempotency_key)
    values (requested_invite_id, requested_study_id, requested_rule_id,
        requested_version, requested_kind, requested_text, requested_consent_version, requested_key)
    returning * into stored;
    return internal.gate2_screening_answer_json(stored);
end;
$$;
revoke all on function public.store_gate2_screening_answer(
    uuid, uuid, uuid, uuid, integer, text, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.store_gate2_screening_answer(
    uuid, uuid, uuid, uuid, integer, text, text, text, text) to service_role;

create function internal.gate2_screening_event_json(event public.gate2_screening_events)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object('answerId', event.answer_id,
        'ruleId', event.rule_id, 'ruleVersion', event.rule_version,
        'interpretation', event.interpretation,
        'span', case when event.start_char is null then null else
            jsonb_build_object('startChar', event.start_char, 'endChar', event.end_char) end,
        'action', event.action, 'confirmedFact', event.confirmed_fact);
$$;
revoke all on function internal.gate2_screening_event_json(public.gate2_screening_events)
    from public, anon, authenticated, service_role;

create function public.get_gate2_screening_decision(requested_answer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select internal.gate2_screening_event_json(event)
    from public.gate2_screening_events as event
    where event.answer_id = requested_answer_id;
$$;
revoke all on function public.get_gate2_screening_decision(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.get_gate2_screening_decision(uuid) to service_role;

create function public.commit_gate2_screening_decision(
    requested_answer_id uuid, requested_rule_id uuid, requested_version integer,
    requested_interpretation text, requested_start integer, requested_end integer,
    requested_action text, requested_confirmed boolean
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
    select * into prior from public.gate2_screening_events
    where answer_id = requested_answer_id for update;
    if found then
        if prior.rule_id <> requested_rule_id or prior.rule_version <> requested_version
            or prior.interpretation is distinct from requested_interpretation
            or prior.start_char is distinct from requested_start
            or prior.end_char is distinct from requested_end
            or prior.action <> requested_action
            or prior.confirmed_fact is distinct from requested_confirmed
        then raise unique_violation; end if;
        return internal.gate2_screening_event_json(prior);
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
        interpretation, start_char, end_char, action, confirmed_fact)
    values (requested_answer_id, requested_rule_id, requested_version,
        requested_interpretation, requested_start, requested_end,
        requested_action, requested_confirmed) returning * into saved;
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
    return internal.gate2_screening_event_json(saved);
end;
$$;
revoke all on function public.commit_gate2_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean)
    from public, anon, authenticated, service_role;
grant execute on function public.commit_gate2_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean) to service_role;

-- Force the service through the validated and idempotent transaction paths.
revoke insert on pii.gate2_screener_answers, public.gate2_screening_events from service_role;
