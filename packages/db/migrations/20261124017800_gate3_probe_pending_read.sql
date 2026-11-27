-- The respondent may not advance past a still-current answer while its
-- consented, qualified follow-up decision is inside the six-second window.
-- This read does not dispatch a model or expose answer/source text.
create function public.read_gate3_probe_pending(
    supplied_session_id uuid, supplied_auth_user_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (
        select 1
        from internal.gate3_probe_opportunities as opportunity
        join public.answers as answer on answer.id = opportunity.answer_id
        left join internal.gate3_probe_turns as turn on turn.answer_id = answer.id
        where opportunity.session_id = supplied_session_id
            and answer.session_id = supplied_session_id
            and answer.created_at + interval '6 seconds' > clock_timestamp()
            and turn.decision_json is null
            and not exists (select 1 from public.answers as replacement
                where replacement.session_id = answer.session_id
                    and replacement.guide_question_id = answer.guide_question_id
                    and replacement.probe_id is not distinct from answer.probe_id
                    and (replacement.created_at, replacement.id) >
                        (answer.created_at, answer.id))
            and internal.gate3_probe_current_for_answer(
                answer.id, supplied_auth_user_id)
    );
$$;
revoke all on function public.read_gate3_probe_pending(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_probe_pending(uuid, uuid)
    to service_role;
