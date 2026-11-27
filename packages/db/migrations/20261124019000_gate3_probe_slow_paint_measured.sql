-- A slow but valid same-origin paint is measured and fails the p95 target.
-- The 30-second server shown deadline still bounds stale UI acknowledgements.
create or replace function public.mark_gate3_probe_shown_with_clock(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid, supplied_browser_clock_origin_id uuid,
    supplied_browser_rendered_ms double precision
) returns text language plpgsql security definer set search_path = '' as $$
declare
    turn internal.gate3_probe_turns%rowtype;
    opportunity internal.gate3_probe_opportunities%rowtype;
    stamped_at timestamptz;
begin
    if supplied_browser_clock_origin_id is null
        or supplied_browser_rendered_ms is null or supplied_browser_rendered_ms < 0
        or supplied_browser_rendered_ms > 1000000000000
        or supplied_browser_rendered_ms in
            ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
    then return 'stale'; end if;
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return 'stale'; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or turn.render_outcome in ('error', 'timeout', 'superseded')
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        or not internal.gate3_probe_receipt_current(turn.id)
    then return 'stale'; end if;
    select * into opportunity from internal.gate3_probe_opportunities
    where answer_id = turn.answer_id;
    if not found or opportunity.browser_clock_origin_id is distinct from
            supplied_browser_clock_origin_id
        or opportunity.browser_upload_receipt_ms is null
        or opportunity.browser_upload_receipt_ms is distinct from
            turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if turn.decided_at + interval '30 seconds' <= clock_timestamp()
        or supplied_browser_rendered_ms < opportunity.browser_upload_receipt_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms,
        render_outcome = 'shown', render_resolved_at = stamped_at where id = turn.id;
    return 'recorded';
end;
$$;

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
                and turn_revision = current_revision
                and ((browser_clock_origin_id is not null
                    and browser_upload_receipt_ms is not null
                    and browser_upload_receipt_ms = browser_upload_confirmed_ms)
                    or (browser_upload_confirmed_ms is null
                        and decision_json ->> 'action' = 'next'
                        and decision_json ->> 'outcome' = 'timeout'))), false)
                as current_turn
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
            'browserClockOriginId', browser_clock_origin_id,
            'browserUploadReceiptMs', browser_upload_receipt_ms,
            'browserUploadConfirmedMs', browser_upload_confirmed_ms,
            'browserRenderedMs', browser_rendered_ms,
            'browserMeasurementComparable', coalesce(
                current_qualified and current_turn and outcome = 'rendered'
                and render_outcome = 'shown'
                and browser_clock_origin_id is not null
                and browser_upload_receipt_ms = browser_upload_confirmed_ms
                and browser_rendered_ms >= browser_upload_receipt_ms,
                false))
            order by server_upload_confirmed_at, answer_id), '[]'::jsonb)) end
    from entries;
$$;
