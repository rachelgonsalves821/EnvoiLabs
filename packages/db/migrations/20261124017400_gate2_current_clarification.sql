-- Display and permit a clarification only while the original qualified
-- decision remains current under its source, model policy and consent.
-- now() is identical for answers saved in one transaction; UUID order cannot
-- identify the revised answer. Use a private insertion sequence as tie-break.
alter table pii.gate2_screener_answers
    add column recorded_sequence bigint generated always as identity;

create or replace function public.read_gate2_screening_sheet(supplied_invite_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('inviteId', offer.id, 'studyId', offer.study_id,
        'expiresAt', offer.expires_at, 'state', offer.state,
        'questions', case when offer.state = 'screened_out' then '[]'::jsonb
            else coalesce((
            select jsonb_agg(jsonb_build_object('ruleId', current_rule.id,
                'ruleVersion', current_rule.version, 'question', current_rule.question,
                'status', case when event.action is not null then event.action
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
    if found and source.idempotency_key <> supplied_key
        and not exists (select 1 from public.gate2_screening_events as event
            where event.answer_id = source.id and event.action = 'clarify'
                and public.get_gate2_current_qualified_screening_decision(
                    source.id, event.provider_model, event.prompt_version,
                    event.prompt_digest) ->> 'action' = 'clarify')
    then raise check_violation; end if;
    perform public.store_gate2_screening_answer(offer.id, owner_id,
        offer.study_id, supplied_rule_id, supplied_version,
        'text', supplied_text, null, supplied_key);
    return jsonb_build_object('inviteId', offer.id, 'ruleId', supplied_rule_id,
        'ruleVersion', supplied_version, 'status', 'pending_review');
end;
$$;
