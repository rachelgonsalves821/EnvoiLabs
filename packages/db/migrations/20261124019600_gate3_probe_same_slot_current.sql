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
