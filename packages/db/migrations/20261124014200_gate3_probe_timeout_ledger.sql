-- A qualified answer that misses its decision deadline still needs a private
-- first-writer outcome. The browser clock is absent when no turn was opened;
-- that absence must not be misreported as a zero-millisecond paint.
alter table internal.gate3_probe_turns alter column browser_upload_confirmed_ms drop not null;
alter table internal.gate3_probe_turns add constraint gate3_probe_missing_browser_clock
    check (browser_upload_confirmed_ms is not null or
        (coalesce(decision_json ->> 'action' = 'next', false) and
         coalesce(decision_json ->> 'outcome' = 'timeout', false)));

create function public.record_gate3_probe_timeout(
    supplied_answer_id uuid, supplied_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    answer public.answers%rowtype;
    interview public.sessions%rowtype;
    source public.transcripts%rowtype;
    job internal.gate1_answer_jobs%rowtype;
    turn internal.gate3_probe_turns%rowtype;
    revision text;
    version_id uuid;
    turn_id uuid;
    deadline timestamptz;
begin
    select * into answer from public.answers where id = supplied_answer_id;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    select * into interview from public.sessions where id = answer.session_id for update;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    select * into source from public.transcripts where answer_id = answer.id;
    select * into job from internal.gate1_answer_jobs where answer_id = answer.id;
    revision := internal.gate3_probe_revision(answer.id);
    version_id := source.redacted_source_version;
    if source.id is null or job.completed_at is null
        or job.completed_at < answer.created_at
        or revision is null or version_id is null
    then return jsonb_build_object('status', 'stale'); end if;
    select * into turn from internal.gate3_probe_turns
    where answer_id = answer.id for update;
    if found then
        if turn.source_version is distinct from version_id
            or turn.transcript_revision is distinct from revision
            or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        then return jsonb_build_object('status', 'stale'); end if;
        if turn.decision_json is null then
            if turn.decision_deadline_at > clock_timestamp()
            then return jsonb_build_object('status', 'not_due'); end if;
            update internal.gate3_probe_turns set
                decision_json = jsonb_build_object('action', 'next',
                    'turnId', turn.id, 'outcome', 'timeout'),
                decided_at = clock_timestamp() where id = turn.id;
        end if;
        turn_id := turn.id;
    else
        if not internal.gate3_probe_current_for_answer(
            answer.id, supplied_auth_user_id)
        then return jsonb_build_object('status', 'stale'); end if;
        deadline := answer.created_at + interval '6 seconds';
        if deadline > clock_timestamp()
        then return jsonb_build_object('status', 'not_due'); end if;
        turn_id := gen_random_uuid();
        insert into internal.gate3_probe_turns (id, answer_id, session_id,
            guide_question_id, transcript_id, source_version,
            transcript_revision, server_upload_confirmed_at,
            transcript_ready_at, decision_deadline_at,
            browser_upload_confirmed_ms, decision_json, decided_at)
        values (turn_id, answer.id, interview.id, answer.guide_question_id,
            source.id, version_id, revision, answer.created_at,
            job.completed_at, deadline, null,
            jsonb_build_object('action', 'next', 'turnId', turn_id,
                'outcome', 'timeout'), clock_timestamp());
    end if;
    return jsonb_build_object('status', 'committed', 'value',
        public.read_gate3_committed_probe(interview.id, turn_id,
            supplied_auth_user_id));
end;
$$;
revoke all on function public.record_gate3_probe_timeout(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_probe_timeout(uuid, uuid)
    to service_role;
