create schema internal;
create schema research;
revoke all on schema internal, research from public, anon, authenticated, service_role;
grant usage on schema internal, research to authenticated;

-- Traverse relationships without granting users access to the intermediate tables.
create function internal.owns_respondent(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.respondents
        where id = target and auth_user_id = auth.uid()
    );
$$;

create function internal.owns_invite(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.invites where id = target and internal.owns_respondent(respondent_id)
    );
$$;

create function internal.owns_session(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.sessions where id = target and internal.owns_invite(invite_id)
    );
$$;

create function internal.has_accepted_invite(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.invites
        join public.respondents on respondents.id = invites.respondent_id
        where invites.study_id = target and invites.state = 'accepted'
            and respondents.auth_user_id = auth.uid() and respondents.status = 'active'
    );
$$;

create function internal.researches_study(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.studies
        join public.researchers using (organization_id)
        where studies.id = target and researchers.auth_user_id = auth.uid()
            and auth.jwt() ->> 'aal' = 'aal2'
    );
$$;

create function internal.researches_transcript(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.transcripts
        join public.answers on answers.id = transcripts.answer_id
        join public.sessions on sessions.id = answers.session_id
        join public.invites on invites.id = sessions.invite_id
        join public.respondents on respondents.id = invites.respondent_id
        left join lateral (
            select granted from public.consents
            where consents.respondent_id = invites.respondent_id
                and purpose = 'researcher_access' and consents.study_id is null
            order by created_at desc, recorded_sequence desc
            limit 1
        ) as general_consent on true
        left join lateral (
            select granted from public.consents
            where consents.respondent_id = invites.respondent_id
                and purpose = 'researcher_access' and consents.study_id = invites.study_id
            order by created_at desc, recorded_sequence desc
            limit 1
        ) as study_consent on true
        where transcripts.id = target and transcripts.redacted_text is not null
            and respondents.status <> 'deleted'
            and internal.researches_study(transcripts.study_id)
            and coalesce(general_consent.granted, true)
            and coalesce(study_consent.granted, general_consent.granted, false)
    );
$$;

revoke all on all functions in schema internal from public, anon, authenticated, service_role;
grant execute on all functions in schema internal to authenticated;

grant select on public.profile_attributes, public.consents, public.screener_answers
    to authenticated;
grant select (id, study_id, state, reward_cents, expires_at, why_you_text)
    on public.invites to authenticated;
grant select (id, invite_id, study_id, state, started_at, submitted_at)
    on public.sessions to authenticated;
grant select (id, session_id, study_id, guide_question_id, probe_id, kind, duration_ms, sequence)
    on public.answers to authenticated;
grant select (id, session_id, guide_question_id, text, decided_at, shown_at)
    on public.probes to authenticated;
grant select (id, amount_cents, state, created_at) on public.payouts to authenticated;
grant select (id, delta, reason, created_at) on public.points_entries to authenticated;
grant select (id, state, created_at) on public.referrals to authenticated;

create policy own_profile on public.profile_attributes
    for select to authenticated using (internal.owns_respondent(respondent_id));
create policy own_consents on public.consents
    for select to authenticated using (internal.owns_respondent(respondent_id));
create policy own_invites on public.invites
    for select to authenticated using (internal.owns_respondent(respondent_id));
create policy own_screeners on public.screener_answers
    for select to authenticated using (internal.owns_invite(invite_id));
create policy own_sessions on public.sessions
    for select to authenticated using (internal.owns_invite(invite_id));
create policy own_answers on public.answers
    for select to authenticated using (internal.owns_session(session_id));
create policy own_probes on public.probes
    for select to authenticated using (internal.owns_session(session_id));
create policy own_payouts on public.payouts
    for select to authenticated using (internal.owns_respondent(respondent_id));
create policy own_points on public.points_entries
    for select to authenticated using (internal.owns_respondent(respondent_id));
create policy own_referrals on public.referrals
    for select to authenticated using (internal.owns_respondent(referrer_id));

grant select (id, organization_id, title, state, target_completes, length_minutes,
    deadline_at, labels, created_at, updated_at) on public.studies to authenticated;
grant select (id, study_id, version, brief_json, created_at) on public.brief_versions to authenticated;
grant select on public.criteria, public.guide_questions to authenticated;
grant select (id, study_id, pricing_config_version, line_items_json, total_cents,
    feasibility_json, created_at) on public.quotes to authenticated;
grant select (id, study_id, version, state, created_at, updated_at) on public.reports to authenticated;
grant select (id, study_id, report_id, position, claim, count, total, confidence)
    on public.findings to authenticated;
grant select (id, study_id, answer_id, redacted_text, created_at) on public.transcripts to authenticated;
grant select (id, study_id, finding_id, transcript_id, start_char, end_char)
    on public.evidence_quotes to authenticated;

create policy tenant_study on public.studies
    for select to authenticated using (internal.researches_study(id));
create policy tenant_brief on public.brief_versions
    for select to authenticated using (internal.researches_study(study_id));
create policy tenant_criteria on public.criteria
    for select to authenticated using (internal.researches_study(study_id));
create policy scoped_guide on public.guide_questions
    for select to authenticated using (
        internal.researches_study(study_id) or internal.has_accepted_invite(study_id)
    );
create policy tenant_quote on public.quotes
    for select to authenticated using (internal.researches_study(study_id));
create policy tenant_report on public.reports
    for select to authenticated using (internal.researches_study(study_id));
create policy tenant_finding on public.findings
    for select to authenticated using (internal.researches_study(study_id));
create policy consented_tenant_transcript on public.transcripts
    for select to authenticated using (internal.researches_transcript(id));
create policy consented_tenant_quote on public.evidence_quotes
    for select to authenticated using (
        internal.researches_study(study_id) and internal.researches_transcript(transcript_id)
    );

-- Read-only projections never carry phone, raw transcript, audio, provider or push data.
create view research.studies with (security_invoker = true) as
    select id, organization_id, title, state, target_completes, length_minutes,
        deadline_at, labels, created_at, updated_at from public.studies;
create view research.reports with (security_invoker = true) as
    select id, study_id, version, state, created_at, updated_at from public.reports;
create view research.findings with (security_invoker = true) as
    select id, study_id, report_id, position, claim, count, total, confidence
    from public.findings;
create view research.transcripts with (security_invoker = true) as
    select id, study_id, answer_id, redacted_text, created_at from public.transcripts;
create view research.evidence_quotes with (security_invoker = true) as
    select q.id, q.study_id, q.finding_id, q.transcript_id, q.start_char, q.end_char,
        substring(t.redacted_text from q.start_char + 1 for q.end_char - q.start_char) as text
    from public.evidence_quotes as q
    join public.transcripts as t on t.id = q.transcript_id
    where q.end_char <= char_length(t.redacted_text);

revoke all on all tables in schema research from public, anon, authenticated, service_role;
grant select on all tables in schema research to authenticated;
