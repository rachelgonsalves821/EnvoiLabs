-- Capture the population before transcription or model work can succeed or
-- fail. Only an answer that was probe-eligible under current purpose grants at
-- insertion is recorded. Deletion follows the source answer.
create table internal.gate3_probe_opportunities (
    answer_id uuid primary key references public.answers (id) on delete cascade,
    study_id uuid not null,
    session_id uuid not null,
    guide_question_id uuid not null,
    respondent_id uuid not null,
    question_position integer not null,
    is_followup boolean not null,
    server_upload_confirmed_at timestamptz not null,
    consent_receipt text not null check (consent_receipt ~ '^[0-9a-f]{64}$'),
    captured_at timestamptz not null default clock_timestamp()
);
create index gate3_probe_opportunities_study
    on internal.gate3_probe_opportunities (study_id, server_upload_confirmed_at, answer_id);
alter table internal.gate3_probe_opportunities enable row level security;
revoke all on internal.gate3_probe_opportunities
    from public, anon, authenticated, service_role;

create function internal.gate3_capture_probe_opportunity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid;
    owner_auth_id uuid;
    position_number integer;
    consent_hash text;
begin
    select respondent.id, respondent.auth_user_id, question.position
    into owner_id, owner_auth_id, position_number
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    join public.guide_questions as question on question.id = new.guide_question_id
    where interview.id = new.session_id and interview.study_id = new.study_id
        and question.study_id = new.study_id;
    if owner_id is null or not internal.gate3_probe_current_for_answer(
        new.id, owner_auth_id) then return new; end if;
    select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(
        consent.purpose, consent.study_id, consent.recorded_sequence,
        consent.granted, consent.text_version)
        order by consent.recorded_sequence), '[]'::jsonb)::text, 'UTF8')), 'hex')
    into consent_hash
    from public.consents as consent
    where consent.respondent_id = owner_id
        and (consent.study_id is null or consent.study_id = new.study_id)
        and consent.purpose in ('retention', 'researcher_access',
            'ai_followup', 'recording', 'transcription_vendor');
    insert into internal.gate3_probe_opportunities (
        answer_id, study_id, session_id, guide_question_id, respondent_id,
        question_position, is_followup, server_upload_confirmed_at,
        consent_receipt)
    values (new.id, new.study_id, new.session_id, new.guide_question_id,
        owner_id, position_number, new.probe_id is not null, new.created_at,
        consent_hash);
    return new;
end;
$$;
create trigger gate3_capture_probe_opportunity after insert on public.answers
for each row execute function internal.gate3_capture_probe_opportunity();
revoke all on function internal.gate3_capture_probe_opportunity()
    from public, anon, authenticated, service_role;

-- One SQL statement supplies a complete study snapshot or withholds it if
-- the pilot-sized bound is exceeded. Source text and respondent identity do
-- not leave this private worker feed. A pending status is never counted as a
-- terminal decision; the timeout caller must resolve it independently.
create function public.read_gate3_probe_opportunity_snapshot(supplied_study_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
    with captured as (
        select opportunity.*,
            source.redacted_source_version as current_source_version,
            internal.gate3_probe_revision(opportunity.answer_id) as current_revision,
            turn.id as turn_id, turn.source_version as turn_source_version,
            turn.transcript_revision as turn_revision, turn.decision_json,
            turn.probe_id, turn.browser_upload_confirmed_ms,
            turn.browser_rendered_ms, turn.shown_at,
            turn.transcript_ready_at, turn.decision_deadline_at, turn.decided_at,
            respondent.status as respondent_status,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'retention') as retention_current,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'researcher_access') as access_current,
            internal.gate1_consent(opportunity.respondent_id,
                opportunity.study_id, 'ai_followup') as followup_current,
            exists (select 1 from public.answers as later
                join public.guide_questions as later_question
                    on later_question.id = later.guide_question_id
                where later.session_id = opportunity.session_id
                    and later.probe_id is null
                    and later_question.position > opportunity.question_position)
                as later_core_answer
        from internal.gate3_probe_opportunities as opportunity
        join public.answers as answer on answer.id = opportunity.answer_id
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
                and access_current and followup_current), false) as current_qualified,
            coalesce((turn_id is not null and turn_source_version = current_source_version
                and turn_revision = current_revision), false) as current_turn
        from captured
    ), entries as (
        select classified.*,
            case
                when not current_qualified then 'withheld'
                when turn_id is not null and not current_turn then 'invalidated'
                when decision_json ->> 'action' = 'probe' and shown_at is not null
                    then 'rendered'
                when decision_json ->> 'action' = 'probe' and later_core_answer
                    then 'superseded'
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
            'decidedAt', decided_at, 'shownAt', shown_at,
            'probeId', case when current_qualified and current_turn
                then probe_id else null end,
            'browserUploadConfirmedMs', browser_upload_confirmed_ms,
            'browserRenderedMs', browser_rendered_ms)
            order by server_upload_confirmed_at, answer_id), '[]'::jsonb)) end
    from entries;
$$;
revoke all on function public.read_gate3_probe_opportunity_snapshot(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_probe_opportunity_snapshot(uuid)
    to service_role;
