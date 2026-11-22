-- Project only the metadata needed for the currently signed-in respondent's Home.
create function public.list_gate1_home_invites() returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', eligible.id,
        'state', eligible.state,
        'rewardCents', eligible.reward_cents,
        'lengthMinutes', eligible.length_minutes,
        'coreQuestionCount', eligible.core_question_count,
        'expiresAt', eligible.expires_at,
        'whyYou', eligible.why_you,
        'resumable', eligible.resumable
    ) order by eligible.expires_at, eligible.id), '[]'::jsonb)
    from (
        select invites.id, invites.state, invites.reward_cents, studies.length_minutes,
            questions.core_question_count, invites.expires_at,
            nullif(btrim(invites.why_you_text), '') as why_you,
            coalesce(sessions.state in ('started', 'in_progress'), false) as resumable
        from public.respondents
        join auth.users on users.id = respondents.auth_user_id
        join public.invites on invites.respondent_id = respondents.id
        join public.studies on studies.id = invites.study_id
        left join public.sessions on sessions.invite_id = invites.id
        cross join lateral (
            select count(*)::integer as core_question_count
            from public.guide_questions where guide_questions.study_id = studies.id
        ) questions
        where respondents.auth_user_id = auth.uid()
            and respondents.status = 'active'
            and users.email_confirmed_at is not null
            and studies.state = 'fielding'
            and questions.core_question_count > 0
            and invites.expires_at > statement_timestamp()
            and (
                invites.state in ('invited', 'screening')
                or (
                    invites.state = 'accepted'
                    and (sessions.id is null or sessions.state in ('started', 'in_progress'))
                )
            )
    ) eligible;
$$;

revoke all on function public.list_gate1_home_invites() from public, anon, authenticated, service_role;
grant execute on function public.list_gate1_home_invites() to authenticated;
