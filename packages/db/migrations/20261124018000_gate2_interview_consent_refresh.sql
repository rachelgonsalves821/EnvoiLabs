-- A resumed interview must recheck the current grant before returning its
-- next question. Answer writes already use gate1_writable_session, which
-- checks retention; this read/transition path previously skipped that guard.
create or replace function public.start_gate1_session(supplied_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    if offer.state <> 'accepted' or offer.expires_at <= clock_timestamp()
        or not internal.gate1_consent(owner_id, offer.study_id, 'retention')
        or not internal.gate1_consent(owner_id, offer.study_id, 'researcher_access')
    then raise check_violation; end if;

    select * into interview from public.sessions where invite_id = offer.id for update;
    if not found or interview.state not in ('started', 'in_progress') then raise check_violation; end if;
    if interview.state = 'started' then
        update public.sessions set state = 'in_progress' where id = interview.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('session', interview.id, 'started', 'in_progress', owner_id::text);
    end if;

    select count(*) into question_count from public.guide_questions where study_id = offer.study_id;
    if question_count not between 4 and 10 then raise check_violation; end if;
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
