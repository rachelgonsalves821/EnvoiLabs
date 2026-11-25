-- Expand the existing private interview path to the frozen marketplace guide range.
-- Gate 1 launch still requires exactly four; marketplace quotes allow 4 through 10.

create or replace function public.start_gate1_session(supplied_invite_id uuid)
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

create or replace function public.record_gate1_text_answer(
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
        where id = supplied_question_id and study_id = interview.study_id and position between 1 and 10;
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

create or replace function public.submit_gate1_session(supplied_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    interview public.sessions%rowtype := internal.gate1_writable_session(supplied_session_id, owner_id);
    question_count integer;
begin
    if interview.state = 'in_progress' then
        select count(*) into question_count from public.guide_questions
        where study_id = interview.study_id;
        if question_count not between 4 and 10 then raise check_violation; end if;
        if (
            select count(distinct question.id)
            from public.answers as answer
            join public.guide_questions as question on question.id = answer.guide_question_id
            where answer.session_id = interview.id and answer.probe_id is null and question.position between 1 and question_count
        ) <> question_count then raise check_violation; end if;

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

create or replace function public.reserve_gate1_audio(supplied_session_id uuid, supplied_question_id uuid, supplied_bytes integer, supplied_mime text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    interview public.sessions%rowtype := internal.gate1_writable_session(supplied_session_id, owner_id);
    reservation internal.gate1_audio_uploads%rowtype;
    offer_deadline timestamptz;
begin
    if interview.state <> 'in_progress' or not internal.gate1_voice_allowed(owner_id, interview.study_id)
        or not exists (
            select 1 from public.guide_questions where id = supplied_question_id and study_id = interview.study_id
                and position between 1 and 10
        )
    then raise check_violation; end if;
    select expires_at into offer_deadline from public.invites where id = interview.invite_id;
    insert into internal.gate1_audio_uploads (session_id, question_id, bytes, mime, expires_at)
    values (interview.id, supplied_question_id, supplied_bytes, supplied_mime,
        least(clock_timestamp() + interval '2 hours', offer_deadline))
    returning * into reservation;

    return jsonb_build_object('audioObjectId', reservation.id,
        'expiresAt', to_char(reservation.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create or replace function public.confirm_gate1_voice_answer(
    supplied_owner_id uuid, supplied_session_id uuid, supplied_question_id uuid, supplied_audio_id uuid,
    supplied_answer_id uuid, supplied_duration_ms integer, supplied_sha256 bytea, supplied_replace_answer_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    interview public.sessions%rowtype;
    reservation internal.gate1_audio_uploads%rowtype;
    answer public.answers%rowtype;
    question_position integer;
    replaced_audio uuid;
    file_path text;
begin
    perform 1 from public.respondents where id = supplied_owner_id and status = 'active' for update;
    if not found then raise insufficient_privilege; end if;
    interview := internal.gate1_writable_session(supplied_session_id, supplied_owner_id);
    if not internal.gate1_voice_allowed(supplied_owner_id, interview.study_id) then raise check_violation; end if;
    if supplied_answer_id is null or supplied_duration_ms is null or supplied_duration_ms not between 1 and 180000
        or octet_length(supplied_sha256) is distinct from 32 then raise invalid_parameter_value; end if;

    select * into reservation from internal.gate1_audio_uploads
    where id = supplied_audio_id and session_id = interview.id and question_id = supplied_question_id for update;
    if not found then raise insufficient_privilege; end if;
    file_path := interview.id::text || '/' || reservation.id::text;

    if reservation.confirmed_answer_id is not null then
        select * into answer from public.answers
        where id = supplied_answer_id and id = reservation.confirmed_answer_id and kind = 'voice'
            and duration_ms = supplied_duration_ms and audio_object_id = reservation.id;
        if not found or not exists (
            select 1 from pii.audio_objects where id = reservation.id and sha256 = supplied_sha256
        ) then raise unique_violation; end if;
    else
        if interview.state <> 'in_progress' or reservation.expires_at <= clock_timestamp() then raise check_violation; end if;
        select position into question_position from public.guide_questions
        where id = supplied_question_id and study_id = interview.study_id and position between 1 and 10;
        if not found then raise check_violation; end if;
        if supplied_replace_answer_id is not null then
            if exists (select 1 from public.answers where session_id = interview.id and sequence > question_position)
            then raise check_violation; end if;
            delete from public.answers
            where id = supplied_replace_answer_id and session_id = interview.id and guide_question_id = supplied_question_id
                and probe_id is null and kind = 'voice'
            returning audio_object_id into replaced_audio;
            if not found then raise check_violation; end if;
            update pii.audio_objects set delete_after = clock_timestamp() where id = replaced_audio;
        elsif question_position <> coalesce((
            select max(sequence) + 1 from public.answers where session_id = interview.id and probe_id is null
        ), 1) then raise check_violation;
        end if;

        insert into pii.audio_objects (id, storage_path, sha256, bytes, mime)
        values (reservation.id, file_path, supplied_sha256, reservation.bytes, reservation.mime);
        insert into public.answers (id, session_id, study_id, guide_question_id, kind, audio_object_id, duration_ms, sequence)
        values (supplied_answer_id, interview.id, interview.study_id, supplied_question_id,
            'voice', reservation.id, supplied_duration_ms, question_position)
        returning * into answer;
        insert into internal.gate1_answer_jobs (answer_id) values (answer.id);
        update internal.gate1_audio_uploads set confirmed_answer_id = answer.id where id = reservation.id;
    end if;

    return jsonb_build_object('answer', jsonb_build_object(
        'id', answer.id, 'sessionId', answer.session_id, 'guideQuestionId', answer.guide_question_id,
        'kind', answer.kind, 'probeId', answer.probe_id, 'durationMs', answer.duration_ms, 'sequence', answer.sequence,
        'createdAt', to_char(answer.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(answer.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
end;
$$;
