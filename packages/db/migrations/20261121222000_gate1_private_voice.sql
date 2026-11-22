insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gate1-interview-audio', 'gate1-interview-audio', false, 20971520,
    array['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table internal.gate1_audio_uploads (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions (id) on delete cascade,
    question_id uuid not null references public.guide_questions (id),
    bytes integer not null check (bytes between 1 and 20971520),
    mime text not null check (mime in ('audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg')),
    expires_at timestamptz not null,
    confirmed_answer_id uuid unique,
    created_at timestamptz not null default now()
);
alter table internal.gate1_audio_uploads enable row level security;
revoke all on internal.gate1_audio_uploads from public, anon, authenticated, service_role;

create function internal.gate1_voice_allowed(owner_id uuid, study_id uuid)
returns boolean language sql stable set search_path = ''
as $$
    select internal.gate1_consent(owner_id, study_id, 'recording')
       and internal.gate1_consent(owner_id, study_id, 'transcription_vendor');
$$;
revoke all on function internal.gate1_voice_allowed(uuid, uuid) from public, anon, authenticated, service_role;

create function public.reserve_gate1_audio(supplied_session_id uuid, supplied_question_id uuid, supplied_bytes integer, supplied_mime text)
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
                and position between 1 and 4
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

create function public.read_gate1_audio_reservation(supplied_session_id uuid, supplied_question_id uuid, supplied_audio_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    interview public.sessions%rowtype := internal.gate1_writable_session(supplied_session_id, owner_id);
    reservation internal.gate1_audio_uploads%rowtype;
begin
    if not internal.gate1_voice_allowed(owner_id, interview.study_id) then raise check_violation; end if;
    select * into reservation from internal.gate1_audio_uploads
    where id = supplied_audio_id and session_id = interview.id and question_id = supplied_question_id;
    if not found then raise insufficient_privilege; end if;
    if reservation.confirmed_answer_id is null and reservation.expires_at <= clock_timestamp()
    then raise check_violation; end if;
    return jsonb_build_object('ownerId', owner_id, 'bytes', reservation.bytes, 'mime', reservation.mime);
end;
$$;

create function public.confirm_gate1_voice_answer(
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
        where id = supplied_question_id and study_id = interview.study_id and position between 1 and 4;
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

revoke all on function public.reserve_gate1_audio(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.read_gate1_audio_reservation(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_gate1_voice_answer(uuid, uuid, uuid, uuid, uuid, integer, bytea, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate1_audio(uuid, uuid, integer, text) to authenticated;
grant execute on function public.read_gate1_audio_reservation(uuid, uuid, uuid) to authenticated;
grant execute on function public.confirm_gate1_voice_answer(uuid, uuid, uuid, uuid, uuid, integer, bytea, uuid) to service_role;
