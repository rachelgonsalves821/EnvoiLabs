-- A respondent sees only the current, committed qualified probe; raw source stays private.
create function public.read_gate3_respondent_probe(
    supplied_session_id uuid, supplied_auth_user_id uuid
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('turnId', turn.id, 'probeId', probe.id,
        'text', probe.text)
    from internal.gate3_probe_turns as turn
    join public.probes as probe on probe.id = turn.probe_id
    where turn.session_id = supplied_session_id
        and turn.decision_json ->> 'action' = 'probe'
        and turn.decision_deadline_at > clock_timestamp()
        and internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        and not exists (select 1 from public.answers as answer
            where answer.probe_id = probe.id)
    order by probe.decided_at desc, probe.id desc limit 1;
$$;
revoke all on function public.read_gate3_respondent_probe(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_respondent_probe(uuid, uuid) to service_role;

create function public.record_gate3_probe_text_answer(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_answer_id uuid, supplied_auth_user_id uuid, supplied_text text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    turn internal.gate3_probe_turns%rowtype;
    probe public.probes%rowtype;
    prior public.answers%rowtype;
    interview public.sessions%rowtype;
    source public.transcripts%rowtype;
    rank_number integer;
begin
    if supplied_answer_id is null or nullif(btrim(supplied_text), '') is null
        then raise invalid_parameter_value; end if;
    select * into interview from public.sessions where id = supplied_session_id for update;
    if not found then raise insufficient_privilege; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.shown_at is null
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then raise insufficient_privilege; end if;
    select * into probe from public.probes where id = supplied_probe_id;
    if not found then raise insufficient_privilege; end if;
    select * into prior from public.answers where probe_id = supplied_probe_id;
    if found then
        if prior.id is distinct from supplied_answer_id then raise unique_violation; end if;
        select * into source from public.transcripts where answer_id = prior.id;
        if not exists (select 1 from pii.transcript_raw as raw
            where raw.transcript_id = source.id and raw.raw_text = supplied_text)
        then raise unique_violation; end if;
    else
        rank_number := internal.gate3_probe_chain_count(turn.answer_id);
        insert into public.answers (id, session_id, study_id, guide_question_id,
            probe_id, kind, sequence)
        values (supplied_answer_id, interview.id, interview.study_id,
            turn.guide_question_id, probe.id, 'text',
            1000 + (select position from public.guide_questions
                where id = turn.guide_question_id) * 10 + rank_number)
        returning * into prior;
        insert into public.transcripts (answer_id, study_id, provider, model,
            latency_ms, cost_micros)
        values (prior.id, interview.study_id, 'typed', 'none', 0, 0)
        returning * into source;
        insert into pii.transcript_raw (transcript_id, raw_text)
        values (source.id, supplied_text);
        insert into internal.gate1_answer_jobs (answer_id) values (prior.id);
    end if;
    return jsonb_build_object('answer', jsonb_build_object(
        'id', prior.id, 'sessionId', prior.session_id,
        'guideQuestionId', prior.guide_question_id, 'kind', prior.kind,
        'probeId', prior.probe_id, 'durationMs', prior.duration_ms,
        'sequence', prior.sequence,
        'createdAt', to_char(prior.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(prior.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;
revoke all on function public.record_gate3_probe_text_answer(
    uuid, uuid, uuid, uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_probe_text_answer(
    uuid, uuid, uuid, uuid, uuid, text) to service_role;
