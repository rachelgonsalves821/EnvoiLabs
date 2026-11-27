-- A bounded private wake queue for qualified, clock-receipted answers. It
-- exposes only IDs. begin_gate3_probe_turn_with_clock repeats the locked
-- consent/source/cap/deadline checks before any model-ready source read.
create function public.list_gate3_probe_ready(supplied_limit integer)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'answerId', ready.answer_id, 'authUserId', ready.auth_user_id)
        order by ready.created_at, ready.answer_id), '[]'::jsonb)
    from (
        select answer.id as answer_id, respondent.auth_user_id,
            answer.created_at
        from internal.gate3_probe_opportunities as opportunity
        join public.answers as answer on answer.id = opportunity.answer_id
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.guide_questions as question on question.id = answer.guide_question_id
        join public.transcripts as source on source.answer_id = answer.id
        join internal.gate1_answer_jobs as job on job.answer_id = answer.id
        left join internal.gate3_probe_turns as turn on turn.answer_id = answer.id
        where opportunity.browser_clock_origin_id is not null
            and opportunity.browser_upload_receipt_ms is not null
            and answer.created_at + interval '6 seconds' > clock_timestamp()
            and job.completed_at is not null
            and job.completed_at < answer.created_at + interval '6 seconds'
            and question.max_probes > 0
            and source.redacted_text is not null
            and (to_jsonb(source) ->> 'redacted_source_version')::uuid is not null
            and (turn.id is null or turn.decision_json is null)
            and internal.gate3_probe_original_consent_current(answer.id)
            and internal.gate3_probe_current_for_answer(
                answer.id, respondent.auth_user_id)
            and (turn.id is null or internal.gate3_probe_current(
                turn.id, respondent.auth_user_id))
        order by answer.created_at, answer.id
        limit least(greatest(coalesce(supplied_limit, 0), 0), 100)
    ) as ready;
$$;
revoke all on function public.list_gate3_probe_ready(integer)
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate3_probe_ready(integer)
    to service_role;
