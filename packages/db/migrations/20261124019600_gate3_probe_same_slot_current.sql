-- A replacement core answer in the same session/question slot supersedes
-- an older answer even when no later guide position exists.
create or replace function internal.gate3_probe_current_for_answer(
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
                join public.guide_questions as later_question
                    on later_question.id = later.guide_question_id
                where later.session_id = interview.id and later.probe_id is null
                    and later_question.study_id = interview.study_id
                    and (later_question.position > question.position
                        or (later_question.id = question.id
                            and (later.created_at, later.id) >
                                (answer.created_at, answer.id)))));
$$;

create or replace function internal.gate3_probe_current(
    supplied_turn_id uuid, supplied_auth_user_id uuid
) returns boolean language sql volatile security definer set search_path = '' as $$
    select exists (select 1 from internal.gate3_probe_turns as turn
        join internal.gate3_probe_opportunities as opportunity
            on opportunity.answer_id = turn.answer_id
        join public.answers as answer on answer.id = turn.answer_id
        join public.transcripts as source on source.id = turn.transcript_id
        join public.sessions as interview on interview.id = turn.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join public.studies as study on study.id = interview.study_id
        join public.guide_questions as question on question.id = turn.guide_question_id
        where turn.id = supplied_turn_id and respondent.auth_user_id = supplied_auth_user_id
            and ((opportunity.browser_clock_origin_id is not null
                and opportunity.browser_upload_receipt_ms is not null
                and opportunity.browser_upload_receipt_ms = turn.browser_upload_confirmed_ms)
                or (turn.browser_upload_confirmed_ms is null
                    and turn.decision_json ->> 'action' = 'next'
                    and turn.decision_json ->> 'outcome' = 'timeout'))
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
                    and (later_question.position > question.position
                        or (later_question.id = question.id
                            and (later.created_at, later.id) >
                                (answer.created_at, answer.id)))));
$$;

-- Keep the private denominator and measured-paint snapshot aligned with the
-- source/decision currentness predicate, including a same-slot replacement.
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
                    and (later_question.position > opportunity.question_position
                        or (later_question.id = opportunity.guide_question_id
                            and (later.created_at, later.id) >
                                (opportunity.server_upload_confirmed_at, opportunity.answer_id))))
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
                when later_core_answer and turn_id is not null
                    and (decision_json is null or
                        (decision_json ->> 'action' = 'probe'
                            and render_outcome is null)) then 'invalidated'
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
