-- Candidate for the Platform migration owner to assign an additive migration version.
-- Existing rows stay private until they have current qualified publication receipts.
create or replace function internal.researches_transcript(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.transcripts
        join public.answers on answers.id = transcripts.answer_id
        join public.sessions on sessions.id = answers.session_id
        join public.invites on invites.id = sessions.invite_id
        join public.respondents on respondents.id = invites.respondent_id
        join internal.gate1_answer_jobs as job on job.answer_id = answers.id
        join internal.gate1_redaction_policies as policy on policy.policy_digest = job.publication_policy_digest
        where transcripts.id = target and transcripts.redacted_text is not null
            and respondents.status <> 'deleted' and internal.researches_study(transcripts.study_id)
            and internal.gate1_consent(respondents.id, transcripts.study_id, 'researcher_access')
            and job.result_status = 'published'
            and policy.qualification_digest = job.publication_qualification_digest
            and policy.revoked_at is null and exists (
                select 1 from internal.gate1_processing_input(answers.id) as item
                where item.source_hash = job.source_hash and item.processing_revision = job.processing_revision
                    and item.publication_revision = job.publication_revision
            )
    );
$$;
