alter table internal.gate1_answer_jobs add column publication_qualification_digest text
    check (publication_qualification_digest ~ '^[0-9a-f]{64}$');

drop function public.complete_gate1_answer_job(uuid, uuid, text, text, text, integer, bigint, text, boolean, text);

create function public.complete_gate1_answer_job(
    supplied_answer_id uuid, supplied_lease_id uuid, supplied_raw_text text default null,
    supplied_provider text default null, supplied_model text default null, supplied_latency_ms integer default null,
    supplied_cost_micros bigint default null, supplied_redacted_text text default null,
    supplied_redaction_passed boolean default false, supplied_policy_digest text default null,
    supplied_qualification_digest text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    approved internal.gate1_redaction_policies%rowtype;
    completion jsonb;
begin
    if supplied_redaction_passed is true and nullif(btrim(supplied_redacted_text), '') is not null then
        select * into approved from internal.gate1_redaction_policies
        where policy_digest = supplied_policy_digest and qualification_digest = supplied_qualification_digest
            and revoked_at is null for share;
    end if;

    completion := internal.complete_gate1_answer_job(
        supplied_answer_id, supplied_lease_id, supplied_raw_text, supplied_provider, supplied_model,
        supplied_latency_ms, supplied_cost_micros, supplied_redacted_text, approved.policy_digest is not null
    );

    if completion ->> 'status' = 'published' then
        update internal.gate1_answer_jobs
        set publication_policy_digest = approved.policy_digest,
            publication_qualification_digest = approved.qualification_digest
        where answer_id = supplied_answer_id;
    end if;
    return completion;
end;
$$;
revoke all on function public.complete_gate1_answer_job(uuid, uuid, text, text, text, integer, bigint, text, boolean, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.complete_gate1_answer_job(uuid, uuid, text, text, text, integer, bigint, text, boolean, text, text)
    to service_role;

create or replace function internal.researches_transcript(target uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
    select exists (
        select 1 from public.transcripts
        join public.answers on answers.id = transcripts.answer_id
        join public.sessions on sessions.id = answers.session_id
        join public.invites on invites.id = sessions.invite_id
        join public.respondents on respondents.id = invites.respondent_id
        left join internal.gate1_answer_jobs as job on job.answer_id = answers.id
        left join internal.gate1_redaction_policies as policy on policy.policy_digest = job.publication_policy_digest
        where transcripts.id = target and transcripts.redacted_text is not null
            and respondents.status <> 'deleted' and internal.researches_study(transcripts.study_id)
            and internal.gate1_consent(respondents.id, transcripts.study_id, 'researcher_access')
            and (job.answer_id is null or (job.result_status = 'published' and policy.policy_digest is not null
                and policy.qualification_digest = job.publication_qualification_digest
                and policy.revoked_at is null and exists (
                    select 1 from internal.gate1_processing_input(answers.id) as item
                    where item.source_hash = job.source_hash and item.processing_revision = job.processing_revision
                        and item.publication_revision = job.publication_revision
                )))
    );
$$;
