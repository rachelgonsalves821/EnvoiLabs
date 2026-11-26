-- A new screening grant must not revive the decision bound to an old grant.
-- Reopen only an unaccepted, unexpired offer after an approved new receipt.
create function internal.gate2_reopen_screening_on_regrant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    grant_row public.consents%rowtype;
    offer_row public.invites%rowtype;
begin
    select * into grant_row from public.consents where id = new.consent_id;
    if not found or grant_row.purpose <> 'ai_screening' or not grant_row.granted
        or grant_row.study_id is null then return new; end if;
    perform 1 from public.studies where id = grant_row.study_id
        and state = 'fielding' for update;
    if not found then return new; end if;
    perform 1 from public.respondents where id = grant_row.respondent_id
        and status = 'active' for update;
    if not found then return new; end if;
    if grant_row.id is distinct from (
        select latest.id from public.consents as latest
        where latest.respondent_id = grant_row.respondent_id
            and latest.study_id = grant_row.study_id
            and latest.purpose = 'ai_screening'
        order by latest.created_at desc, latest.recorded_sequence desc limit 1
    ) or not exists (
        select 1 from internal.gate2_screening_model_policies as policy
        where policy.consent_text_version = grant_row.text_version
            and policy.consent_text_digest = new.text_digest
            and policy.approved_at <= clock_timestamp()
            and policy.revoked_at is null
    ) then return new; end if;
    for offer_row in select * from public.invites as offer
        where offer.study_id = grant_row.study_id
            and offer.respondent_id = grant_row.respondent_id
            and offer.state = 'invited'
            and offer.expires_at > clock_timestamp()
        for update
    loop
        if exists (select 1 from pii.gate2_screener_answers as answer
            join public.gate2_screening_events as event
                on event.answer_id = answer.id and event.action = 'qualify'
            join internal.gate2_screening_decision_grants as binding
                on binding.event_id = event.id
            where answer.invite_id = offer_row.id
                and answer.study_id = offer_row.study_id
                and binding.consent_id <> grant_row.id)
            and not internal.gate2_screening_offer_current(
                offer_row.id, offer_row.study_id)
        then
            update public.invites set state = 'screening'
                where id = offer_row.id and state = 'invited';
            insert into public.audit_log (entity, entity_id, from_state,
                to_state, actor, meta) values ('invite', offer_row.id,
                'invited', 'screening', 'platform',
                jsonb_build_object('reason', 'screening_consent_regrant'));
        end if;
    end loop;
    return new;
end;
$$;
revoke all on function internal.gate2_reopen_screening_on_regrant()
    from public, anon, authenticated, service_role;
create trigger gate2_reopen_screening_on_regrant
    after insert on internal.gate2_screening_consent_receipts
    for each row execute function internal.gate2_reopen_screening_on_regrant();

create function internal.gate2_reanswer_authorized(
    requested_answer_id uuid, requested_offer_id uuid,
    requested_study_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from pii.gate2_screener_answers as answer
        join public.invites as offer on offer.id = answer.invite_id
            and offer.study_id = answer.study_id
        join public.gate2_screening_events as old_event
            on old_event.answer_id = answer.id and old_event.action = 'qualify'
        join internal.gate2_screening_decision_grants as binding
            on binding.event_id = old_event.id
        join lateral (
            select grant_row.* from public.consents as grant_row
            where grant_row.respondent_id = offer.respondent_id
                and grant_row.study_id = offer.study_id
                and grant_row.purpose = 'ai_screening'
            order by grant_row.created_at desc,
                grant_row.recorded_sequence desc limit 1
        ) as current_grant on current_grant.granted
            and current_grant.id <> binding.consent_id
        join internal.gate2_screening_consent_receipts as receipt
            on receipt.consent_id = current_grant.id
        join internal.gate2_screening_model_policies as policy
            on policy.consent_text_version = current_grant.text_version
            and policy.consent_text_digest = receipt.text_digest
            and policy.approved_at <= now() and policy.revoked_at is null
        where answer.id = requested_answer_id
            and offer.id = requested_offer_id
            and offer.study_id = requested_study_id
            and offer.state = 'screening'
            and exists (select 1 from public.audit_log as transition
                where transition.entity = 'invite'
                    and transition.entity_id = offer.id
                    and transition.from_state = 'invited'
                    and transition.to_state = 'screening'
                    and transition.meta ->> 'reason'
                        = 'screening_consent_regrant')
    );
$$;
revoke all on function internal.gate2_reanswer_authorized(uuid,uuid,uuid)
    from public, anon, authenticated, service_role;

create or replace function public.read_gate2_screening_sheet(supplied_invite_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('inviteId', offer.id, 'studyId', offer.study_id,
        'expiresAt', offer.expires_at, 'state', offer.state,
        'questions', case when offer.state = 'screened_out' then '[]'::jsonb
            else coalesce((
            select jsonb_agg(jsonb_build_object('ruleId', current_rule.id,
                'ruleVersion', current_rule.version, 'question', current_rule.question,
                'status', case when event.action is not null then event.action
                    when stale_event.id is not null then 'reanswer'
                    when answer.id is not null then 'pending_review'
                    when queued.id is not null then 'pending_transcription'
                    else 'unanswered' end)
                order by current_rule.approved_at, current_rule.id)
            from public.gate2_screening_rules as current_rule
            left join lateral (
                select source.id from pii.gate2_screener_answers as source
                where source.invite_id = offer.id and source.rule_id = current_rule.id
                    and source.rule_version = current_rule.version
                    and (source.kind <> 'voice' or
                        internal.gate2_screening_transcript_current(source.transcription_receipt_id))
                order by source.created_at desc, source.recorded_sequence desc limit 1
            ) as answer on true
            left join public.gate2_screening_events as event
                on event.answer_id = answer.id
                and event.action = public.get_gate2_current_qualified_screening_decision(
                    answer.id, event.provider_model, event.prompt_version,
                    event.prompt_digest) ->> 'action'
            left join public.gate2_screening_events as stale_event
                on stale_event.answer_id = answer.id and event.id is null
                and internal.gate2_reanswer_authorized(
                    answer.id, offer.id, offer.study_id)
            left join lateral (
                select audio.id from internal.gate2_screening_audio_uploads as audio
                where audio.invite_id = offer.id and audio.rule_id = current_rule.id
                    and audio.rule_version = current_rule.version
                    and audio.confirmed_at is not null and audio.completed_at is null
                    and exists (select 1 from internal.gate2_screening_audio_source(audio.id))
                order by audio.confirmed_at desc, audio.id desc limit 1
            ) as queued on true
            where current_rule.study_id = offer.study_id
                and current_rule.approved_at <= clock_timestamp()
                and not exists (select 1 from public.gate2_screening_rules as newer
                    where newer.criterion_id = current_rule.criterion_id
                        and newer.version > current_rule.version
                        and newer.approved_at <= clock_timestamp())
        ), '[]'::jsonb) end)
    from public.invites as offer
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join public.studies as study on study.id = offer.study_id
    where offer.id = supplied_invite_id
        and (offer.state = 'screening' or (offer.state = 'screened_out'
            and internal.gate2_current_screened_out_result(offer.id, offer.study_id)))
        and offer.expires_at > clock_timestamp() and study.state = 'fielding'
        and respondent.auth_user_id = auth.uid() and respondent.status = 'active'
        and internal.gate1_consent(respondent.id, study.id, 'retention');
$$;

create or replace function public.submit_gate2_screening_text(
    supplied_invite_id uuid, supplied_rule_id uuid,
    supplied_version integer, supplied_text text, supplied_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid;
    offer public.invites%rowtype;
    source pii.gate2_screener_answers%rowtype;
    study_id uuid;
begin
    if supplied_text is null or length(supplied_text) > 2000
        or nullif(btrim(supplied_text), '') is null
        or supplied_key !~ '^gate2-screen:[a-f0-9-]{36}$'
    then raise check_violation; end if;
    select candidate.study_id into study_id from public.invites as candidate
        where candidate.id = supplied_invite_id;
    if study_id is null then raise insufficient_privilege; end if;
    perform 1 from public.studies where id = study_id for update;
    owner_id := internal.lock_active_respondent();
    select * into offer from public.invites
    where id = supplied_invite_id and respondent_id = owner_id for update;
    if not found or offer.state <> 'screening' or offer.expires_at <= clock_timestamp()
        or not internal.gate1_consent(owner_id, offer.study_id, 'retention')
        or public.get_gate2_screening_rule(supplied_rule_id, offer.study_id,
            supplied_version) is null
    then raise insufficient_privilege; end if;
    select * into source from pii.gate2_screener_answers
        where invite_id = offer.id and rule_id = supplied_rule_id
            and rule_version = supplied_version
        order by created_at desc, recorded_sequence desc limit 1;
    if found and source.idempotency_key = supplied_key
        and exists (select 1 from public.gate2_screening_events as event
            where event.answer_id = source.id
                and public.get_gate2_current_qualified_screening_decision(
                    source.id, event.provider_model, event.prompt_version,
                    event.prompt_digest) is null)
    then raise check_violation; end if;
    if found and source.idempotency_key <> supplied_key
        and not exists (select 1 from public.gate2_screening_events as event
            where event.answer_id = source.id and event.action = 'clarify'
                and public.get_gate2_current_qualified_screening_decision(
                    source.id, event.provider_model, event.prompt_version,
                    event.prompt_digest) ->> 'action' = 'clarify')
        and not exists (select 1 from public.gate2_screening_events as event
            where event.answer_id = source.id
                and public.get_gate2_current_qualified_screening_decision(
                    source.id, event.provider_model, event.prompt_version,
                    event.prompt_digest) is null
                and internal.gate2_reanswer_authorized(
                    source.id, offer.id, offer.study_id))
    then raise check_violation; end if;
    perform public.store_gate2_screening_answer(offer.id, owner_id,
        offer.study_id, supplied_rule_id, supplied_version,
        'text', supplied_text, null, supplied_key);
    return jsonb_build_object('inviteId', offer.id, 'ruleId', supplied_rule_id,
        'ruleVersion', supplied_version, 'status', 'pending_review');
end;
$$;

-- A re-answer only restores eligibility when every latest rule has a current,
-- consent-bound qualified decision. The prior immutable event is not enough.
create or replace function internal.commit_gate2_screening_decision_inner(
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
                    and event.rule_version = rule.version and event.action = 'qualify'
                    and public.get_gate2_current_qualified_screening_decision(
                        answer.id, event.provider_model, event.prompt_version,
                        event.prompt_digest) ->> 'action' = 'qualify')
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
