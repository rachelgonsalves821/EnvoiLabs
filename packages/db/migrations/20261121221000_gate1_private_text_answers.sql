create table internal.gate1_answer_jobs (
    answer_id uuid primary key references public.answers (id) on delete cascade,
    queued_at timestamptz not null default now(),
    available_at timestamptz not null default now(),
    attempts integer not null default 0 check (attempts >= 0),
    lease_id uuid,
    lease_expires_at timestamptz,
    completed_at timestamptz,
    check ((lease_id is null) = (lease_expires_at is null))
);
alter table internal.gate1_answer_jobs enable row level security;
revoke all on internal.gate1_answer_jobs from public, anon, authenticated, service_role;

create function internal.gate1_consent(target_respondent uuid, target_study uuid, target_purpose text)
returns boolean language sql stable set search_path = ''
as $$
    with general as (
        select granted from public.consents
        where respondent_id = target_respondent and study_id is null and purpose = target_purpose
        order by created_at desc, recorded_sequence desc limit 1
    ), specific as (
        select granted from public.consents
        where respondent_id = target_respondent and study_id = target_study and purpose = target_purpose
        order by created_at desc, recorded_sequence desc limit 1
    )
    select coalesce((select granted from general), true)
      and coalesce((select granted from specific), (select granted from general), false);
$$;

create function internal.gate1_writable_session(target_session uuid, owner_id uuid)
returns public.sessions language plpgsql set search_path = ''
as $$
declare
    interview public.sessions%rowtype;
begin
    select session.* into interview
    from public.sessions as session
    join public.invites as offer on offer.id = session.invite_id
    join public.studies as study on study.id = session.study_id
    where session.id = target_session and offer.respondent_id = owner_id
        and offer.state = 'accepted' and study.state = 'fielding'
    for update of session;
    if not found then raise insufficient_privilege; end if;
    if exists (select 1 from public.invites where id = interview.invite_id and expires_at <= clock_timestamp())
        or not internal.gate1_consent(owner_id, interview.study_id, 'retention')
    then raise check_violation; end if;
    return interview;
end;
$$;

create function public.record_gate1_text_answer(
    supplied_session_id uuid,
    supplied_question_id uuid,
    supplied_answer_id uuid,
    supplied_text text,
    supplied_replace_answer_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    interview public.sessions%rowtype := internal.gate1_writable_session(supplied_session_id, owner_id);
    answer public.answers%rowtype;
    question_position integer;
    transcript_id uuid;
begin
    if supplied_answer_id is null or supplied_question_id is null
        or coalesce(btrim(supplied_text), '') = '' then raise invalid_parameter_value; end if;

    select * into answer from public.answers where id = supplied_answer_id;
    if found then
        if answer.session_id <> interview.id or answer.guide_question_id <> supplied_question_id or answer.kind <> 'text'
            or not exists (
                select 1 from public.transcripts as transcript
                join pii.transcript_raw as raw on raw.transcript_id = transcript.id
                where transcript.answer_id = answer.id and raw.raw_text = supplied_text
            )
        then raise unique_violation; end if;
    else
        if interview.state <> 'in_progress' then raise check_violation; end if;
        select position into question_position from public.guide_questions
        where id = supplied_question_id and study_id = interview.study_id and position between 1 and 4;
        if not found then raise check_violation; end if;

        if supplied_replace_answer_id is not null then
            if exists (select 1 from public.answers where session_id = interview.id and sequence > question_position)
            then raise check_violation; end if;
            delete from public.answers
            where id = supplied_replace_answer_id and session_id = interview.id and guide_question_id = supplied_question_id
                and probe_id is null and kind = 'text';
            if not found then raise check_violation; end if;
        elsif question_position <> coalesce((
            select max(sequence) + 1 from public.answers where session_id = interview.id and probe_id is null
        ), 1) then raise check_violation;
        end if;

        insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
        values (supplied_answer_id, interview.id, interview.study_id, supplied_question_id, 'text', question_position)
        returning * into answer;

        insert into public.transcripts (answer_id, study_id, provider, model, latency_ms, cost_micros)
        values (answer.id, interview.study_id, 'typed', 'none', 0, 0) returning id into transcript_id;
        insert into pii.transcript_raw (transcript_id, raw_text) values (transcript_id, supplied_text);
        insert into internal.gate1_answer_jobs (answer_id) values (answer.id);
    end if;

    return jsonb_build_object('answer', jsonb_build_object(
        'id', answer.id, 'sessionId', answer.session_id, 'guideQuestionId', answer.guide_question_id,
        'kind', answer.kind, 'probeId', answer.probe_id, 'durationMs', answer.duration_ms, 'sequence', answer.sequence,
        'createdAt', to_char(answer.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(answer.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
end;
$$;

create function public.submit_gate1_session(supplied_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    interview public.sessions%rowtype := internal.gate1_writable_session(supplied_session_id, owner_id);
begin
    if interview.state = 'in_progress' then
        if (
            select count(distinct question.id)
            from public.answers as answer
            join public.guide_questions as question on question.id = answer.guide_question_id
            where answer.session_id = interview.id and answer.probe_id is null and question.position between 1 and 4
        ) <> 4 then raise check_violation; end if;

        update public.sessions set state = 'submitted', submitted_at = clock_timestamp() where id = interview.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('session', interview.id, 'in_progress', 'submitted', owner_id::text);
        update public.sessions set state = 'quality_hold' where id = interview.id;
        insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
        values ('session', interview.id, 'submitted', 'quality_hold', 'platform');
    elsif interview.state not in ('submitted', 'quality_hold') then raise check_violation;
    end if;
    return jsonb_build_object('sessionId', interview.id, 'state', 'submitted');
end;
$$;

revoke all on function internal.gate1_consent(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function internal.gate1_writable_session(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_gate1_text_answer(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.submit_gate1_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_gate1_text_answer(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.submit_gate1_session(uuid) to authenticated;
