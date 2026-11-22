create function public.update_gate1_invite(supplied_invite_id uuid, supplied_action text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    offer public.invites%rowtype;
    next_state text;
    interview_id uuid;
begin
    if supplied_action = 'accept' then next_state := 'accepted';
    elsif supplied_action = 'decline' then next_state := 'declined';
    else raise invalid_parameter_value;
    end if;
    select invitation.* into offer
    from public.invites as invitation
    join public.studies as study on study.id = invitation.study_id
    where invitation.id = supplied_invite_id and invitation.respondent_id = owner_id
        and study.state = 'fielding'
    for update of invitation;
    if not found then raise insufficient_privilege; end if;

    if offer.state = next_state then
        return jsonb_build_object('inviteId', offer.id, 'state', offer.state);
    end if;
    if offer.state <> 'invited' or offer.expires_at <= clock_timestamp() then raise check_violation; end if;

    update public.invites set state = next_state where id = offer.id;
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
    values ('invite', offer.id, 'invited', next_state, owner_id::text);
    if next_state = 'accepted' then
        insert into public.sessions (invite_id, study_id)
        values (offer.id, offer.study_id) returning id into interview_id;
        insert into public.audit_log (entity, entity_id, to_state, actor)
        values ('session', interview_id, 'started', owner_id::text);
    end if;
    return jsonb_build_object('inviteId', offer.id, 'state', next_state);
end;
$$;

create function public.start_gate1_session(supplied_invite_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    offer public.invites%rowtype;
    interview public.sessions%rowtype;
    next_question public.guide_questions%rowtype;
    question_count integer;
begin
    select invitation.* into offer
    from public.invites as invitation
    join public.studies as study on study.id = invitation.study_id
    where invitation.id = supplied_invite_id and invitation.respondent_id = owner_id
        and study.state = 'fielding'
    for update of invitation;
    if not found then raise insufficient_privilege; end if;
    if offer.state <> 'accepted' or offer.expires_at <= clock_timestamp() then raise check_violation; end if;

    select * into interview from public.sessions where invite_id = offer.id for update;
    if not found or interview.state not in ('started', 'in_progress') then raise check_violation; end if;
    if interview.state = 'started' then
        update public.sessions set state = 'in_progress' where id = interview.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('session', interview.id, 'started', 'in_progress', owner_id::text);
    end if;

    select count(*) into question_count from public.guide_questions where study_id = offer.study_id;
    if question_count <> 4 then raise check_violation; end if;
    select question.* into next_question from public.guide_questions as question
    where question.study_id = offer.study_id and not exists (
        select 1 from public.answers as answer
        where answer.session_id = interview.id and answer.guide_question_id = question.id
            and answer.probe_id is null
    )
    order by question.position limit 1;

    return jsonb_build_object(
        'sessionId', interview.id,
        'expiresAt', to_char(offer.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'progress', jsonb_build_object(
            'sessionId', interview.id, 'currentQuestion', coalesce(next_question.position, question_count),
            'coreQuestionCount', question_count, 'rewardCents', offer.reward_cents
        ),
        'nextQuestion', case when next_question.id is not null
            then jsonb_build_object('id', next_question.id, 'text', next_question.text)
            else null end
    );
end;
$$;

revoke all on function public.update_gate1_invite(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.start_gate1_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.update_gate1_invite(uuid, text) to authenticated;
grant execute on function public.start_gate1_session(uuid) to authenticated;
