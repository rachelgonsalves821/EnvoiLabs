-- A screened-out offer needs an intelligible result for its respondent, but
-- an old decision must disappear after consent, source or policy withdrawal.
create function internal.gate2_current_screened_out_result(
    target_offer uuid, target_study uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.gate2_screening_events as decision
        join pii.gate2_screener_answers as answer on answer.id = decision.answer_id
        where answer.invite_id = target_offer and answer.study_id = target_study
            and decision.action = 'screen_out'
            and public.get_gate2_current_qualified_screening_decision(
                answer.id, decision.provider_model, decision.prompt_version,
                decision.prompt_digest) ->> 'action' = 'screen_out');
$$;
revoke all on function internal.gate2_current_screened_out_result(uuid,uuid)
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
                order by source.created_at desc, source.id desc limit 1
            ) as answer on true
            left join public.gate2_screening_events as event on event.answer_id = answer.id
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
