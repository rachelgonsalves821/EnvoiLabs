-- A committed probe is not a rendered probe. Give the browser receipt a
-- bounded delivery window, then persist a separate terminal display outcome.
alter table internal.gate3_probe_turns
    add column render_outcome text check (render_outcome in ('shown', 'timeout', 'superseded')),
    add column render_resolved_at timestamptz;
update internal.gate3_probe_turns set render_outcome = 'shown',
    render_resolved_at = shown_at where shown_at is not null;
alter table internal.gate3_probe_turns add constraint gate3_probe_render_terminal_shape
    check ((render_outcome is null) = (render_resolved_at is null)
        and coalesce(render_outcome = 'shown', false) = (shown_at is not null)
        and (render_outcome is null or decision_json ->> 'action' = 'probe'));

create or replace function internal.gate3_keep_probe_turn_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
    if (new.id, new.answer_id, new.session_id, new.guide_question_id,
        new.transcript_id, new.source_version, new.transcript_revision,
        new.server_upload_confirmed_at, new.transcript_ready_at,
        new.decision_deadline_at, new.browser_upload_confirmed_ms) is distinct from
       (old.id, old.answer_id, old.session_id, old.guide_question_id,
        old.transcript_id, old.source_version, old.transcript_revision,
        old.server_upload_confirmed_at, old.transcript_ready_at,
        old.decision_deadline_at, old.browser_upload_confirmed_ms)
        or (old.decision_json is not null and (new.decision_json, new.probe_id,
            new.decided_at) is distinct from (old.decision_json, old.probe_id,
            old.decided_at))
        or (old.shown_at is not null and (new.shown_at, new.browser_rendered_ms)
            is distinct from (old.shown_at, old.browser_rendered_ms))
        or (old.render_outcome is not null and (new.render_outcome,
            new.render_resolved_at) is distinct from (old.render_outcome,
            old.render_resolved_at))
    then raise check_violation using message = 'probe turn is immutable'; end if;
    return new;
end;
$$;

create or replace function public.mark_gate3_probe_shown(
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
        or turn.render_outcome in ('timeout', 'superseded')
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if supplied_browser_rendered_ms > turn.browser_upload_confirmed_ms + 6000
        or supplied_browser_rendered_ms < turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms,
        render_outcome = 'shown', render_resolved_at = stamped_at where id = turn.id;
    return 'recorded';
end;
$$;

-- The same session lock as the shown receipt makes first resolution win.
-- This private audit can settle a vanished browser even after consent was
-- withdrawn; respondent and researcher reads still withhold stale sources.
create function public.record_gate3_probe_render_terminal(
    supplied_turn_id uuid, supplied_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    existing internal.gate3_probe_turns%rowtype;
    turn internal.gate3_probe_turns%rowtype;
    owner_auth_id uuid;
    later_core boolean;
    terminal text;
begin
    select * into existing from internal.gate3_probe_turns
    where id = supplied_turn_id;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    perform 1 from public.sessions where id = existing.session_id for update;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id for update;
    select respondent.auth_user_id into owner_auth_id
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    where interview.id = turn.session_id;
    if turn.id is null or owner_auth_id is distinct from supplied_auth_user_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
    then return jsonb_build_object('status', 'stale'); end if;
    if turn.render_outcome is not null then
        return jsonb_build_object('status', 'resolved',
            'outcome', turn.render_outcome, 'turnId', turn.id);
    end if;
    select exists (select 1 from public.answers as later
        join public.guide_questions as later_question
            on later_question.id = later.guide_question_id
        join public.guide_questions as original_question
            on original_question.id = turn.guide_question_id
        where later.session_id = turn.session_id and later.probe_id is null
            and later_question.position > original_question.position)
    into later_core;
    if later_core then terminal := 'superseded';
    elsif turn.decided_at + interval '30 seconds' <= clock_timestamp()
        then terminal := 'timeout';
    else return jsonb_build_object('status', 'not_due'); end if;
    update internal.gate3_probe_turns set render_outcome = terminal,
        render_resolved_at = clock_timestamp() where id = turn.id;
    return jsonb_build_object('status', 'resolved',
        'outcome', terminal, 'turnId', turn.id);
end;
$$;
revoke all on function public.record_gate3_probe_render_terminal(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_probe_render_terminal(uuid, uuid)
    to service_role;

-- The opportunity reader reports only a stored terminal display outcome.
create or replace function public.read_gate3_probe_opportunity_snapshot(supplied_study_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
    with captured as (
        select opportunity.*, source.redacted_source_version as current_source_version,
            internal.gate3_probe_revision(opportunity.answer_id) as current_revision,
            turn.id as turn_id, turn.source_version as turn_source_version,
            turn.transcript_revision as turn_revision, turn.decision_json,
            turn.probe_id, turn.browser_upload_confirmed_ms,
            turn.browser_rendered_ms, turn.shown_at,
            turn.render_outcome, turn.render_resolved_at,
            turn.transcript_ready_at, turn.decision_deadline_at, turn.decided_at,
            respondent.status as respondent_status,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'retention') as retention_current,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'researcher_access') as access_current,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'ai_followup') as followup_current,
            internal.gate3_probe_consent_receipt(opportunity.respondent_id,
                opportunity.study_id) as current_consent_receipt,
            exists (select 1 from public.answers as later
                join public.guide_questions as later_question
                    on later_question.id = later.guide_question_id
                where later.session_id = opportunity.session_id
                    and later.probe_id is null
                    and later_question.position > opportunity.question_position)
                as later_core_answer
        from internal.gate3_probe_opportunities as opportunity
        join public.respondents as respondent on respondent.id = opportunity.respondent_id
        left join public.transcripts as source on source.answer_id = opportunity.answer_id
        left join internal.gate3_probe_turns as turn on turn.answer_id = opportunity.answer_id
        where opportunity.study_id = supplied_study_id
        order by opportunity.server_upload_confirmed_at, opportunity.answer_id
        limit 5001
    ), classified as (
        select captured.*,
            coalesce((current_revision is not null and current_source_version is not null
                and respondent_status = 'active' and retention_current
                and access_current and followup_current
                and consent_receipt = current_consent_receipt), false)
                as current_qualified,
            coalesce((turn_id is not null and turn_source_version = current_source_version
                and turn_revision = current_revision), false) as current_turn
        from captured
    ), entries as (
        select classified.*,
            case
                when not current_qualified then 'withheld'
                when turn_id is not null and not current_turn then 'invalidated'
                when decision_json ->> 'action' = 'probe' and render_outcome = 'shown'
                    then 'rendered'
                when decision_json ->> 'action' = 'probe' and render_outcome is not null
                    then render_outcome
                when decision_json ->> 'action' = 'probe' then 'pending_render'
                when decision_json ->> 'action' = 'next'
                    then decision_json ->> 'outcome'
                when later_core_answer then 'superseded'
                else 'pending'
            end as outcome
        from classified
    )
    select case when count(*) > 5000 then null else jsonb_build_object(
        'studyId', supplied_study_id, 'recordedCount', count(*),
        'items', coalesce(jsonb_agg(jsonb_build_object(
            'answerId', answer_id, 'sessionId', session_id,
            'questionId', guide_question_id, 'questionPosition', question_position,
            'isFollowup', is_followup, 'consentReceipt', consent_receipt,
            'serverUploadConfirmedAt', server_upload_confirmed_at,
            'transcriptReadyAt', transcript_ready_at,
            'decisionDeadlineAt', coalesce(decision_deadline_at,
                server_upload_confirmed_at + interval '6 seconds'),
            'sourceVersion', current_source_version,
            'turnSourceVersion', turn_source_version,
            'turnId', turn_id, 'currentQualified', current_qualified,
            'currentTurn', current_turn, 'outcome', outcome,
            'renderOutcome', render_outcome, 'renderResolvedAt', render_resolved_at,
            'decidedAt', decided_at, 'shownAt', shown_at,
            'probeId', case when current_qualified and current_turn
                then probe_id else null end,
            'browserUploadConfirmedMs', browser_upload_confirmed_ms,
            'browserRenderedMs', browser_rendered_ms)
            order by server_upload_confirmed_at, answer_id), '[]'::jsonb)) end
    from entries;
$$;
