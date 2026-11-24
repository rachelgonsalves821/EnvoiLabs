-- This purpose has no onboarding grant path. Real model dispatch remains off
-- until the consent text and use of interview text by an LLM are approved.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
    'recording', 'transcription_vendor', 'retention', 'researcher_access',
    'voice_clip_sharing', 'ai_followup'
));

create table internal.gate3_probe_turns (
    id uuid primary key default gen_random_uuid(),
    answer_id uuid not null unique,
    session_id uuid not null,
    guide_question_id uuid not null,
    transcript_id uuid not null references public.transcripts (id) on delete cascade,
    source_version uuid not null,
    transcript_revision text not null check (transcript_revision ~ '^[0-9a-f]{64}$'),
    server_upload_confirmed_at timestamptz not null,
    transcript_ready_at timestamptz not null,
    decision_deadline_at timestamptz not null,
    browser_upload_confirmed_ms double precision not null,
    decision_json jsonb,
    probe_id uuid unique references public.probes (id),
    decided_at timestamptz,
    browser_rendered_ms double precision,
    shown_at timestamptz,
    foreign key (answer_id, session_id, guide_question_id)
        references public.answers (id, session_id, guide_question_id) on delete cascade,
    check (transcript_ready_at >= server_upload_confirmed_at),
    check (decision_deadline_at > server_upload_confirmed_at),
    check ((decision_json is null) = (decided_at is null)),
    check (shown_at is null or probe_id is not null)
);
alter table internal.gate3_probe_turns enable row level security;
revoke all on internal.gate3_probe_turns from public, anon, authenticated, service_role;

create function internal.gate3_keep_probe_turn_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
    if (new.id, new.answer_id, new.session_id, new.guide_question_id,
        new.transcript_id, new.source_version, new.transcript_revision, new.server_upload_confirmed_at,
        new.transcript_ready_at, new.decision_deadline_at,
        new.browser_upload_confirmed_ms) is distinct from
       (old.id, old.answer_id, old.session_id, old.guide_question_id,
        old.transcript_id, old.source_version, old.transcript_revision, old.server_upload_confirmed_at,
        old.transcript_ready_at, old.decision_deadline_at,
        old.browser_upload_confirmed_ms)
        or (old.decision_json is not null and (new.decision_json, new.probe_id,
            new.decided_at) is distinct from (old.decision_json, old.probe_id,
            old.decided_at))
        or (old.shown_at is not null and (new.shown_at, new.browser_rendered_ms)
            is distinct from (old.shown_at, old.browser_rendered_ms))
    then raise check_violation using message = 'probe turn is immutable'; end if;
    return new;
end;
$$;
create trigger gate3_keep_probe_turn_identity before update on internal.gate3_probe_turns
for each row execute function internal.gate3_keep_probe_turn_identity();
revoke all on function internal.gate3_keep_probe_turn_identity()
    from public, anon, authenticated, service_role;

-- A policy receipt or same-text republication changes this revision. The
-- source itself is returned only by a restricted server RPC after consent.
create function internal.gate3_probe_revision(supplied_answer_id uuid)
returns text language sql stable security definer set search_path = '' as $$
    select encode(sha256(convert_to(jsonb_build_array(
        answer.id, answer.updated_at, transcript.id, transcript.updated_at,
        transcript.redacted_text,
        to_jsonb(transcript) ->> 'redacted_source_version',
        encode(job.source_hash, 'hex'),
        job.completed_at, job.publication_policy_digest,
        job.publication_qualification_digest,
        coalesce((select jsonb_agg(jsonb_build_array(consent.purpose,
            consent.study_id, consent.recorded_sequence, consent.granted)
            order by consent.recorded_sequence)
            from public.consents as consent
            where consent.respondent_id = offer.respondent_id
                and (consent.study_id is null or consent.study_id = interview.study_id)
                and consent.purpose in ('retention', 'researcher_access',
                    'ai_followup', 'recording', 'transcription_vendor')),
            '[]'::jsonb))::text, 'UTF8')), 'hex')
    from public.answers as answer
    join public.sessions as interview on interview.id = answer.session_id
    join public.invites as offer on offer.id = interview.invite_id
    join public.transcripts as transcript on transcript.answer_id = answer.id
    join internal.gate1_answer_jobs as job on job.answer_id = answer.id
    join internal.gate1_redaction_policies as policy
        on policy.policy_digest = job.publication_policy_digest
        and policy.qualification_digest = job.publication_qualification_digest
    where answer.id = supplied_answer_id and job.result_status = 'published'
        and job.completed_at is not null and policy.revoked_at is null
        and (to_jsonb(transcript) ->> 'redacted_source_version') is not null
        and nullif(btrim(transcript.redacted_text), '') is not null;
$$;
revoke all on function internal.gate3_probe_revision(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate3_probe_root_answer(supplied_answer_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
    with recursive ancestry as (
        select answer.id, answer.probe_id, 0 as depth
        from public.answers as answer where answer.id = supplied_answer_id
        union all
        select parent.id, parent.probe_id, child.depth + 1
        from ancestry as child
        join public.probes as link on link.id = child.probe_id
        join public.answers as parent on parent.id = link.answer_id
        where child.depth < 8
    )
    select id from ancestry where probe_id is null order by depth desc limit 1;
$$;
revoke all on function internal.gate3_probe_root_answer(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate3_probe_chain_count(supplied_answer_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
    with recursive chain as (
        select root.id, 0 as depth from public.answers as root
        where root.id = internal.gate3_probe_root_answer(supplied_answer_id)
        union all
        select reply.id, chain.depth + 1 from chain
        join public.probes as probe on probe.answer_id = chain.id
        join public.answers as reply on reply.probe_id = probe.id
        where chain.depth < 8
    )
    select count(*) from public.probes as probe
    where probe.answer_id in (select id from chain);
$$;
revoke all on function internal.gate3_probe_chain_count(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate3_probe_current_for_answer(
    supplied_answer_id uuid, supplied_auth_user_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (select 1 from public.answers as answer
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.studies as study on study.id = interview.study_id
        join public.guide_questions as question on question.id = answer.guide_question_id
        where answer.id = supplied_answer_id and respondent.auth_user_id = supplied_auth_user_id
            and respondent.status = 'active' and offer.state = 'accepted'
            and offer.expires_at > clock_timestamp() and study.state = 'fielding'
            and interview.state = 'in_progress'
            and (answer.probe_id is null or exists (
                select 1 from public.probes as parent
                where parent.id = answer.probe_id and parent.shown_at is not null))
            and question.study_id = interview.study_id and question.position > 0
            and question.max_probes > 0
            and internal.gate3_probe_chain_count(answer.id) < question.max_probes
            and internal.gate1_consent(respondent.id, interview.study_id, 'retention')
            and internal.gate1_consent(respondent.id, interview.study_id, 'researcher_access')
            and internal.gate1_consent(respondent.id, interview.study_id, 'ai_followup')
            and (answer.kind = 'text' or (
                internal.gate1_consent(respondent.id, interview.study_id, 'recording')
                and internal.gate1_consent(respondent.id, interview.study_id, 'transcription_vendor')))
            and not exists (select 1 from public.answers as later
                where later.session_id = interview.id and later.probe_id is null
                    and later.sequence > answer.sequence));
$$;
revoke all on function internal.gate3_probe_current_for_answer(uuid, uuid)
    from public, anon, authenticated, service_role;

create function internal.gate3_probe_current(
    supplied_turn_id uuid, supplied_auth_user_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (select 1 from internal.gate3_probe_turns as turn
        join public.answers as answer on answer.id = turn.answer_id
        join public.transcripts as source on source.id = turn.transcript_id
        join public.sessions as interview on interview.id = turn.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.studies as study on study.id = interview.study_id
        join public.guide_questions as question on question.id = turn.guide_question_id
        where turn.id = supplied_turn_id and respondent.auth_user_id = supplied_auth_user_id
            and respondent.status = 'active' and offer.state = 'accepted'
            and offer.expires_at > clock_timestamp() and study.state = 'fielding'
            and interview.state = 'in_progress'
            and (answer.probe_id is null or exists (
                select 1 from public.probes as parent
                where parent.id = answer.probe_id and parent.shown_at is not null))
            and answer.session_id = interview.id and answer.guide_question_id = question.id
            and question.study_id = interview.study_id and question.position > 0
            and turn.transcript_revision = internal.gate3_probe_revision(answer.id)
            and turn.source_version::text = (to_jsonb(source) ->> 'redacted_source_version')
            and internal.gate1_consent(respondent.id, interview.study_id, 'retention')
            and internal.gate1_consent(respondent.id, interview.study_id, 'researcher_access')
            and internal.gate1_consent(respondent.id, interview.study_id, 'ai_followup')
            and (answer.kind = 'text' or (
                internal.gate1_consent(respondent.id, interview.study_id, 'recording')
                and internal.gate1_consent(respondent.id, interview.study_id, 'transcription_vendor')))
            and not exists (select 1 from public.answers as later
                where later.session_id = interview.id and later.probe_id is null
                    and later.sequence > answer.sequence));
$$;
revoke all on function internal.gate3_probe_current(uuid, uuid)
    from public, anon, authenticated, service_role;

create function public.begin_gate3_probe_turn(
    supplied_answer_id uuid, supplied_auth_user_id uuid,
    supplied_browser_upload_ms double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    answer public.answers%rowtype;
    interview public.sessions%rowtype;
    question public.guide_questions%rowtype;
    source public.transcripts%rowtype;
    job internal.gate1_answer_jobs%rowtype;
    prior internal.gate3_probe_turns%rowtype;
    revision text;
    version_id uuid;
    created_id uuid;
begin
    if supplied_browser_upload_ms is null or supplied_browser_upload_ms < 0
        or supplied_browser_upload_ms > 1000000000000
        or supplied_browser_upload_ms = 'Infinity'::float8
        or supplied_browser_upload_ms = '-Infinity'::float8
        or supplied_browser_upload_ms = 'NaN'::float8
    then return null; end if;
    select * into answer from public.answers where id = supplied_answer_id;
    if not found then return null; end if;
    select * into interview from public.sessions where id = answer.session_id for update;
    select * into question from public.guide_questions where id = answer.guide_question_id;
    select * into source from public.transcripts where answer_id = answer.id;
    select * into job from internal.gate1_answer_jobs where answer_id = answer.id;
    revision := internal.gate3_probe_revision(answer.id);
    version_id := (to_jsonb(source) ->> 'redacted_source_version')::uuid;
    if interview.id is null or source.id is null or job.completed_at is null
        or revision is null or version_id is null or question.max_probes = 0
        or job.completed_at >= answer.created_at + interval '6 seconds'
        or not internal.gate3_probe_current_for_answer(
            answer.id, supplied_auth_user_id)
    then return null; end if;
    select * into prior from internal.gate3_probe_turns where answer_id = answer.id;
    if found then return case when prior.transcript_revision = revision
        and prior.source_version = version_id
        and prior.browser_upload_confirmed_ms = supplied_browser_upload_ms
        then prior.id else null end; end if;
    insert into internal.gate3_probe_turns
        (answer_id, session_id, guide_question_id, transcript_id, source_version,
            transcript_revision, server_upload_confirmed_at, transcript_ready_at,
            decision_deadline_at, browser_upload_confirmed_ms)
    values (answer.id, answer.session_id, answer.guide_question_id, source.id, version_id,
        revision, answer.created_at, job.completed_at,
        answer.created_at + interval '6 seconds', supplied_browser_upload_ms)
    returning id into created_id;
    return created_id;
end;
$$;
revoke all on function public.begin_gate3_probe_turn(uuid, uuid, double precision)
    from public, anon, authenticated, service_role;
grant execute on function public.begin_gate3_probe_turn(uuid, uuid, double precision)
    to service_role;

create function public.read_gate3_ready_probe_turn(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_auth_user_id uuid
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object(
        'sessionId', turn.session_id, 'questionId', turn.guide_question_id,
        'answerId', turn.answer_id, 'turnId', turn.id,
        'sourceVersion', turn.source_version,
        'transcriptRevision', turn.transcript_revision,
        'probesUsed', internal.gate3_probe_chain_count(turn.answer_id),
        'maxProbes', question.max_probes,
        'decisionDeadlineAtMs', extract(epoch from turn.decision_deadline_at) * 1000,
        'serverUploadConfirmedAtMs', extract(epoch from turn.server_upload_confirmed_at) * 1000,
        'browserUploadConfirmedAtMs', turn.browser_upload_confirmed_ms,
        'transcriptReadyAtMs', extract(epoch from turn.transcript_ready_at) * 1000,
        'sourceText', transcript.redacted_text, 'questionText', question.text)
    from internal.gate3_probe_turns as turn
    join public.transcripts as transcript on transcript.id = turn.transcript_id
    join public.guide_questions as question on question.id = turn.guide_question_id
    where turn.id = supplied_turn_id and turn.session_id = supplied_session_id
        and turn.decision_json is null
        and turn.decision_deadline_at > clock_timestamp()
        and internal.gate3_probe_current(turn.id, supplied_auth_user_id);
$$;
revoke all on function public.read_gate3_ready_probe_turn(uuid, uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_ready_probe_turn(uuid, uuid, uuid)
    to service_role;

create function public.read_gate3_committed_probe(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_auth_user_id uuid
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('sessionId', turn.session_id,
        'questionId', turn.guide_question_id, 'answerId', turn.answer_id,
        'turnId', turn.id, 'transcriptRevision', turn.transcript_revision,
        'sourceVersion', turn.source_version,
        'decision', turn.decision_json, 'probeId', turn.probe_id)
    from internal.gate3_probe_turns as turn
    where turn.id = supplied_turn_id and turn.session_id = supplied_session_id
        and turn.decision_json is not null
        and internal.gate3_probe_current(turn.id, supplied_auth_user_id);
$$;
revoke all on function public.read_gate3_committed_probe(uuid, uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_committed_probe(uuid, uuid, uuid)
    to service_role;

create function public.commit_gate3_probe_decision(
    supplied_session_id uuid, supplied_question_id uuid, supplied_answer_id uuid,
    supplied_turn_id uuid, supplied_auth_user_id uuid,
    supplied_source_version uuid, supplied_transcript_revision text,
    supplied_decision jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    turn internal.gate3_probe_turns%rowtype;
    action_text text;
    probe_uuid uuid;
    result_json jsonb;
begin
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.answer_id is distinct from supplied_answer_id
        or turn.guide_question_id is distinct from supplied_question_id
        or turn.source_version is distinct from supplied_source_version
        or turn.transcript_revision is distinct from supplied_transcript_revision
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return jsonb_build_object('status', 'stale'); end if;
    if turn.decision_json is not null then
        return jsonb_build_object('status', 'committed', 'value',
            jsonb_build_object('sessionId', turn.session_id,
                'questionId', turn.guide_question_id, 'answerId', turn.answer_id,
                'turnId', turn.id, 'transcriptRevision', turn.transcript_revision,
                'sourceVersion', turn.source_version,
                'decision', turn.decision_json, 'probeId', turn.probe_id));
    end if;
    if turn.decision_deadline_at <= clock_timestamp()
        or jsonb_typeof(supplied_decision) is distinct from 'object'
        or supplied_decision ->> 'turnId' is distinct from turn.id::text
    then return jsonb_build_object('status', 'stale'); end if;
    action_text := supplied_decision ->> 'action';
    if action_text = 'probe' then
        if jsonb_typeof(supplied_decision -> 'uploadConfirmedAtMs') <> 'number'
            or (supplied_decision ->> 'uploadConfirmedAtMs')::double precision
                is distinct from turn.browser_upload_confirmed_ms
            or nullif(btrim(supplied_decision ->> 'text'), '') is null
            or char_length(supplied_decision ->> 'text') > 240
            or right(supplied_decision ->> 'text', 1) <> '?'
            or internal.gate3_probe_chain_count(turn.answer_id)
                >= (select max_probes from public.guide_questions
                    where id = turn.guide_question_id)
            or (select count(*) from jsonb_object_keys(supplied_decision)) <> 4
        then return jsonb_build_object('status', 'stale'); end if;
        insert into public.probes (answer_id, session_id, guide_question_id,
            text, decided_at)
        values (turn.answer_id, turn.session_id, turn.guide_question_id,
            supplied_decision ->> 'text', clock_timestamp()) returning id into probe_uuid;
    elsif action_text = 'next' then
        if supplied_decision ->> 'outcome' not in
            ('no_probe', 'error', 'timeout', 'superseded')
            or (select count(*) from jsonb_object_keys(supplied_decision)) <> 3
        then return jsonb_build_object('status', 'stale'); end if;
    else return jsonb_build_object('status', 'stale'); end if;
    update internal.gate3_probe_turns set decision_json = supplied_decision,
        probe_id = probe_uuid, decided_at = clock_timestamp()
    where id = turn.id;
    result_json := jsonb_build_object('sessionId', turn.session_id,
        'questionId', turn.guide_question_id, 'answerId', turn.answer_id,
        'turnId', turn.id, 'transcriptRevision', turn.transcript_revision,
        'sourceVersion', turn.source_version,
        'decision', supplied_decision, 'probeId', probe_uuid);
    return jsonb_build_object('status', 'committed', 'value', result_json);
end;
$$;
revoke all on function public.commit_gate3_probe_decision(
    uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.commit_gate3_probe_decision(
    uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) to service_role;

create function public.mark_gate3_probe_shown(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid, supplied_browser_rendered_ms double precision
) returns text language plpgsql security definer set search_path = '' as $$
declare turn internal.gate3_probe_turns%rowtype;
declare stamped_at timestamptz;
begin
    if supplied_browser_rendered_ms is null or supplied_browser_rendered_ms < 0
        or supplied_browser_rendered_ms > 1000000000000
        or supplied_browser_rendered_ms = 'Infinity'::float8
        or supplied_browser_rendered_ms = '-Infinity'::float8
        or supplied_browser_rendered_ms = 'NaN'::float8
    then return 'stale'; end if;
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return 'stale'; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if turn.decision_deadline_at <= clock_timestamp()
        or supplied_browser_rendered_ms < turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms where id = turn.id;
    return 'recorded';
end;
$$;
revoke all on function public.mark_gate3_probe_shown(
    uuid, uuid, uuid, uuid, double precision)
    from public, anon, authenticated, service_role;
grant execute on function public.mark_gate3_probe_shown(
    uuid, uuid, uuid, uuid, double precision) to service_role;
