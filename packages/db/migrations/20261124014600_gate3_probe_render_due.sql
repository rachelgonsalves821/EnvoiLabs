-- A private, bounded candidate read for committed probes with no display
-- outcome. The locked terminal RPC remains the authority for each candidate.
create function public.list_gate3_probe_render_due(supplied_limit integer)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'turnId', due.turn_id, 'authUserId', due.auth_user_id)
        order by due.decided_at, due.turn_id), '[]'::jsonb)
    from (
        select turn.id as turn_id, respondent.auth_user_id, turn.decided_at
        from internal.gate3_probe_turns as turn
        join public.sessions as interview on interview.id = turn.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        where turn.decision_json ->> 'action' = 'probe'
            and turn.render_outcome is null
            and (turn.decided_at + interval '30 seconds' <= clock_timestamp()
                or exists (select 1 from public.answers as later
                    join public.guide_questions as later_question
                        on later_question.id = later.guide_question_id
                    join public.guide_questions as original_question
                        on original_question.id = turn.guide_question_id
                    where later.session_id = turn.session_id
                        and later.probe_id is null
                        and later_question.position > original_question.position))
        order by turn.decided_at, turn.id
        limit least(greatest(coalesce(supplied_limit, 0), 0), 100)
    ) as due;
$$;
revoke all on function public.list_gate3_probe_render_due(integer)
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate3_probe_render_due(integer)
    to service_role;
