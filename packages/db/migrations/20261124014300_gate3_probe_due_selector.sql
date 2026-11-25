-- A bounded private sweep finds qualified, still-current probe opportunities
-- whose server deadline elapsed. The timeout RPC performs the authoritative
-- locked consent/source/first-writer recheck for each returned answer.
create function public.list_gate3_probe_due(supplied_limit integer)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'answerId', due.answer_id, 'authUserId', due.auth_user_id)
        order by due.created_at, due.answer_id), '[]'::jsonb)
    from (
        select answer.id as answer_id, respondent.auth_user_id,
            answer.created_at
        from public.answers as answer
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        left join internal.gate3_probe_turns as turn on turn.answer_id = answer.id
        where coalesce(turn.decision_deadline_at,
                answer.created_at + interval '6 seconds') <= clock_timestamp()
            and (turn.id is null or turn.decision_json is null)
            and internal.gate3_probe_revision(answer.id) is not null
            and internal.gate3_probe_current_for_answer(
                answer.id, respondent.auth_user_id)
            and (turn.id is null or internal.gate3_probe_current(
                turn.id, respondent.auth_user_id))
        order by answer.created_at, answer.id
        limit least(greatest(coalesce(supplied_limit, 0), 0), 100)
    ) as due;
$$;
revoke all on function public.list_gate3_probe_due(integer)
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate3_probe_due(integer)
    to service_role;
