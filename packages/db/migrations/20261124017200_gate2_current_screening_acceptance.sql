-- A previously qualified offer is not enough to accept an interview after
-- its source, rule, model purpose or policy has ceased to be current.
create function internal.gate2_screening_offer_current(
    target_offer uuid, target_study uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select not exists (
        select 1 from public.gate2_screening_rules as rule
        where rule.study_id = target_study and rule.approved_at <= now()
            and not exists (select 1 from public.gate2_screening_rules as newer
                where newer.criterion_id = rule.criterion_id
                    and newer.version > rule.version
                    and newer.approved_at <= now())
            and not exists (
                select 1 from pii.gate2_screener_answers as answer
                join public.gate2_screening_events as decision
                    on decision.answer_id = answer.id
                where answer.invite_id = target_offer
                    and answer.study_id = target_study
                    and answer.rule_id = rule.id
                    and answer.rule_version = rule.version
                    and decision.action = 'qualify'
                    and public.get_gate2_current_qualified_screening_decision(
                        answer.id, decision.provider_model,
                        decision.prompt_version, decision.prompt_digest)
                        ->> 'action' = 'qualify'));
$$;
revoke all on function internal.gate2_screening_offer_current(uuid,uuid)
    from public, anon, authenticated, service_role;

create function internal.gate2_guard_screened_offer_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.state = 'invited' and new.state = 'accepted' then
        -- Consent writes take this same respondent lock, so withdrawal and
        -- acceptance serialize before the source is rechecked.
        perform 1 from public.respondents where id = old.respondent_id for update;
        if not internal.gate2_screening_offer_current(old.id, old.study_id)
        then raise check_violation; end if;
    end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_screened_offer_acceptance()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_screened_offer_acceptance
    before update of state on public.invites for each row
    execute function internal.gate2_guard_screened_offer_acceptance();

-- Home must not advertise an offer that its accept command will refuse.
create or replace function public.list_gate1_home_invites() returns jsonb
language sql stable security definer set search_path = pg_catalog as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', eligible.id, 'state', eligible.state,
        'rewardCents', eligible.reward_cents,
        'lengthMinutes', eligible.length_minutes,
        'coreQuestionCount', eligible.core_question_count,
        'expiresAt', eligible.expires_at, 'whyYou', eligible.why_you,
        'resumable', eligible.resumable
    ) order by eligible.expires_at, eligible.id), '[]'::jsonb)
    from (
        select invites.id, invites.state, invites.reward_cents,
            studies.length_minutes, questions.core_question_count,
            invites.expires_at, nullif(btrim(invites.why_you_text), '') as why_you,
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
            and (invites.state <> 'invited' or
                internal.gate2_screening_offer_current(invites.id, invites.study_id))
            and (invites.state in ('invited', 'screening')
                or (invites.state = 'accepted'
                    and (sessions.id is null or
                        sessions.state in ('started', 'in_progress'))))
    ) eligible;
$$;
