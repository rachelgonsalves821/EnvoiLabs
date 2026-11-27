-- A qualified-answer wake and a later clock-receipt wake each target one answer.
-- The bounded batch selector can omit it under load before its six-second deadline.
-- Return IDs only; begin/readReadyTurn repeat locked source and consent checks.
create function public.read_gate3_probe_ready_answer(supplied_answer_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('answerId', answer.id,
        'sessionId', answer.session_id, 'authUserId', respondent.auth_user_id)
    from internal.gate3_probe_opportunities as opportunity
    join public.answers as answer on answer.id = opportunity.answer_id
    join public.sessions as interview on interview.id = answer.session_id
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join public.guide_questions as question on question.id = answer.guide_question_id
    join public.transcripts as source on source.answer_id = answer.id
    join internal.gate1_answer_jobs as job on job.answer_id = answer.id
    left join internal.gate3_probe_turns as turn on turn.answer_id = answer.id
    where answer.id = supplied_answer_id
        and opportunity.browser_clock_origin_id is not null
        and opportunity.browser_upload_receipt_ms is not null
        and answer.created_at + interval '6 seconds' > clock_timestamp()
        and job.completed_at is not null
        and job.completed_at < answer.created_at + interval '6 seconds'
        and question.max_probes > 0
        and source.redacted_text is not null
        and source.redacted_source_version is not null
        and (turn.id is null or turn.decision_json is null)
        and internal.gate3_probe_original_consent_current(answer.id)
        and internal.gate3_probe_current_for_answer(
            answer.id, respondent.auth_user_id)
        and (turn.id is null or internal.gate3_probe_current(
            turn.id, respondent.auth_user_id));
$$;
revoke all on function public.read_gate3_probe_ready_answer(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_probe_ready_answer(uuid)
    to service_role;
