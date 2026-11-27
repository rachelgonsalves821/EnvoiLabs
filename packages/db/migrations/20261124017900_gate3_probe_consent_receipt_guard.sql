-- A later AI grant must never retroactively authorize an answer that was
-- outside the captured opportunity population. Withdrawal and regrant also
-- invalidate the original receipt, even when the redacted text is unchanged.
create function internal.gate3_probe_original_consent_current(
    supplied_answer_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1
        from internal.gate3_probe_opportunities as opportunity
        where opportunity.answer_id = supplied_answer_id
            and opportunity.consent_receipt =
                internal.gate3_probe_consent_receipt(
                    opportunity.respondent_id, opportunity.study_id));
$$;
revoke all on function internal.gate3_probe_original_consent_current(uuid)
    from public, anon, authenticated, service_role;

create or replace function internal.gate3_probe_current(
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
            and internal.gate3_probe_original_consent_current(answer.id)
            and internal.gate1_consent(respondent.id, interview.study_id, 'retention')
            and internal.gate1_consent(respondent.id, interview.study_id, 'researcher_access')
            and internal.gate1_consent(respondent.id, interview.study_id, 'ai_followup')
            and (answer.kind = 'text' or (
                internal.gate1_consent(respondent.id, interview.study_id, 'recording')
                and internal.gate1_consent(respondent.id, interview.study_id, 'transcription_vendor')))
            and not exists (select 1 from public.answers as later
                join public.guide_questions as later_question
                    on later_question.id = later.guide_question_id
                where later.session_id = interview.id and later.probe_id is null
                    and later_question.study_id = interview.study_id
                    and later_question.position > question.position));
$$;

create or replace function public.begin_gate3_probe_turn(
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
        or not internal.gate3_probe_original_consent_current(answer.id)
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

create or replace function public.read_gate3_probe_pending(
    supplied_session_id uuid, supplied_auth_user_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (
        select 1
        from internal.gate3_probe_opportunities as opportunity
        join public.answers as answer on answer.id = opportunity.answer_id
        left join internal.gate3_probe_turns as turn on turn.answer_id = answer.id
        where opportunity.session_id = supplied_session_id
            and answer.session_id = supplied_session_id
            and answer.created_at + interval '6 seconds' > clock_timestamp()
            and turn.decision_json is null
            and not exists (select 1 from public.answers as replacement
                where replacement.session_id = answer.session_id
                    and replacement.guide_question_id = answer.guide_question_id
                    and replacement.probe_id is not distinct from answer.probe_id
                    and (replacement.created_at, replacement.id) >
                        (answer.created_at, answer.id))
            and internal.gate3_probe_original_consent_current(answer.id)
            and internal.gate3_probe_current_for_answer(
                answer.id, supplied_auth_user_id)
    );
$$;
