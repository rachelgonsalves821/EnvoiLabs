alter table internal.gate1_answer_jobs
    add column source_hash bytea,
    add column processing_revision bigint,
    add column publication_revision bigint,
    add column result_status text check (result_status in ('private', 'published')),
    add column completed_lease_id uuid,
    add check ((result_status is null) = (completed_at is null));

create index gate1_answer_jobs_ready on internal.gate1_answer_jobs (available_at, queued_at, answer_id)
    where completed_at is null;

-- Derive eligibility and source versions from the current answer and consent rows.
create function internal.gate1_processing_input(target_answer uuid)
returns table (
    kind text, study_id uuid, transcript_id uuid, raw_text text, storage_path text,
    mime text, bytes integer, duration_ms integer, audio_hash text, source_hash bytea,
    processing_revision bigint, publication_revision bigint, may_publish boolean
)
language sql stable set search_path = ''
as $$
    select answer.kind, answer.study_id, transcript.id, raw.raw_text, audio.storage_path,
        audio.mime, audio.bytes, answer.duration_ms, encode(audio.sha256, 'hex'),
        sha256(convert_to(jsonb_build_array(answer.kind, extract(epoch from answer.updated_at), answer.audio_object_id,
            audio.storage_path, audio.mime, audio.bytes, answer.duration_ms, encode(audio.sha256, 'hex'), raw.raw_text,
            transcript.id, transcript.redacted_text)::text, 'UTF8')),
        revisions.processing, revisions.publication,
        internal.gate1_consent(respondent.id, answer.study_id, 'researcher_access')
    from public.answers as answer
    join public.sessions as interview on interview.id = answer.session_id
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    left join pii.audio_objects as audio on audio.id = answer.audio_object_id
    left join public.transcripts as transcript on transcript.answer_id = answer.id
    left join pii.transcript_raw as raw on raw.transcript_id = transcript.id
    cross join lateral (
        select coalesce(max(recorded_sequence) filter (where purpose = 'retention'
            or (answer.kind = 'voice' and purpose in ('recording', 'transcription_vendor'))), 0) as processing,
            coalesce(max(recorded_sequence) filter (where purpose = 'researcher_access'), 0) as publication
        from public.consents
        where respondent_id = respondent.id and (consents.study_id is null or consents.study_id = answer.study_id)
    ) as revisions
    where answer.id = target_answer and respondent.status = 'active'
        and offer.state = 'accepted'
        and interview.state in ('in_progress', 'submitted', 'quality_hold', 'approved', 'paid')
        and internal.gate1_consent(respondent.id, answer.study_id, 'retention')
        and (
            (answer.kind = 'text' and coalesce(btrim(raw.raw_text), '') <> '')
            or (answer.kind = 'voice' and audio.id is not null
                and (audio.delete_after is null or audio.delete_after > clock_timestamp())
                and internal.gate1_consent(respondent.id, answer.study_id, 'recording')
                and internal.gate1_consent(respondent.id, answer.study_id, 'transcription_vendor'))
        );
$$;

-- Keep lock order consistent with consent updates and answer replacement.
create function internal.lock_gate1_processing_respondent(target_answer uuid)
returns boolean language plpgsql set search_path = ''
as $$
begin
    perform respondent.id
    from public.answers as answer
    join public.sessions as interview on interview.id = answer.session_id
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    where answer.id = target_answer and respondent.status = 'active'
    for update of respondent;
    if not found then return false; end if;
    perform 1 from public.answers where id = target_answer for update;
    return found;
end;
$$;

create function public.claim_gate1_answer_job(supplied_answer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    target uuid;
    job internal.gate1_answer_jobs%rowtype;
    item record;
begin
    select queued.answer_id into target
    from internal.gate1_answer_jobs as queued
    join public.answers as answer on answer.id = queued.answer_id
    join public.sessions as interview on interview.id = answer.session_id
    join public.invites as offer on offer.id = interview.invite_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    where (supplied_answer_id is null or queued.answer_id = supplied_answer_id)
        and queued.completed_at is null and queued.available_at <= clock_timestamp()
        and (queued.lease_id is null or queued.lease_expires_at <= clock_timestamp())
        and exists (select 1 from internal.gate1_processing_input(queued.answer_id))
    order by queued.available_at, queued.queued_at, queued.answer_id
    limit 1 for update of respondent skip locked;
    if not found then return null; end if;

    select * into job from internal.gate1_answer_jobs where answer_id = target for update skip locked;
    if not found or job.completed_at is not null or job.available_at > clock_timestamp()
        or job.lease_expires_at > clock_timestamp() then return null; end if;
    select * into item from internal.gate1_processing_input(target);
    if not found then return null; end if;

    update internal.gate1_answer_jobs set lease_id = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '2 minutes', attempts = attempts + 1,
        source_hash = item.source_hash, processing_revision = item.processing_revision,
        publication_revision = item.publication_revision
    where answer_id = target returning * into job;

    return jsonb_build_object('answerId', target, 'leaseId', job.lease_id,
        'leaseExpiresAt', job.lease_expires_at, 'kind', item.kind, 'attempts', job.attempts)
        || case when item.kind = 'text' then jsonb_build_object('rawText', item.raw_text)
            else jsonb_build_object('audio', jsonb_build_object('storagePath', item.storage_path,
                'mime', item.mime, 'bytes', item.bytes, 'sha256', item.audio_hash,
                'durationMs', item.duration_ms)) end;
end;
$$;

create function public.validate_gate1_answer_job(supplied_answer_id uuid, supplied_lease_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
    if not internal.lock_gate1_processing_respondent(supplied_answer_id) then return false; end if;
    return exists (
        select 1 from internal.gate1_answer_jobs as job
        join internal.gate1_processing_input(supplied_answer_id) as item on true
        where job.answer_id = supplied_answer_id and job.lease_id = supplied_lease_id
            and job.lease_expires_at > clock_timestamp() and job.completed_at is null
            and job.source_hash = item.source_hash and job.processing_revision = item.processing_revision
    );
end;
$$;

create function public.retry_gate1_answer_job(
    supplied_answer_id uuid, supplied_lease_id uuid, supplied_delay_seconds integer default 30
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
    if supplied_delay_seconds is null or supplied_delay_seconds not between 0 and 3600
    then raise invalid_parameter_value; end if;
    if not internal.lock_gate1_processing_respondent(supplied_answer_id) then return false; end if;
    update internal.gate1_answer_jobs set lease_id = null, lease_expires_at = null,
        available_at = clock_timestamp() + make_interval(secs => supplied_delay_seconds)
    where answer_id = supplied_answer_id and lease_id = supplied_lease_id
        and lease_expires_at > clock_timestamp() and completed_at is null;
    return found;
end;
$$;

create function public.complete_gate1_answer_job(
    supplied_answer_id uuid, supplied_lease_id uuid, supplied_raw_text text default null,
    supplied_provider text default null, supplied_model text default null, supplied_latency_ms integer default null,
    supplied_cost_micros bigint default null, supplied_redacted_text text default null,
    supplied_redaction_passed boolean default false
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    stale jsonb := jsonb_build_object('status', 'stale', 'transcriptId', null);
    job internal.gate1_answer_jobs%rowtype;
    item record;
    transcript uuid;
    publication text;
    result text;
begin
    if not internal.lock_gate1_processing_respondent(supplied_answer_id) then return stale; end if;
    select * into job from internal.gate1_answer_jobs where answer_id = supplied_answer_id for update;
    if not found then return stale; end if;
    if job.completed_at is not null and job.completed_lease_id = supplied_lease_id then
        select id into transcript from public.transcripts where answer_id = supplied_answer_id;
        return jsonb_build_object('status', 'alreadyCompleted', 'transcriptId', transcript);
    end if;
    if job.lease_id is null or job.lease_id is distinct from supplied_lease_id
        or job.lease_expires_at <= clock_timestamp() or job.completed_at is not null then return stale; end if;

    select * into item from internal.gate1_processing_input(supplied_answer_id);
    if not found or job.source_hash is distinct from item.source_hash
        or job.processing_revision is distinct from item.processing_revision then return stale; end if;

    -- Only the trusted worker may assert that both qualified redaction stages passed.
    if supplied_redaction_passed is true and item.may_publish
        and job.publication_revision = item.publication_revision
    then publication := nullif(btrim(supplied_redacted_text), ''); end if;
    result := case when publication is null then 'private' else 'published' end;

    if item.kind = 'text' then
        if supplied_raw_text is not null or supplied_provider is not null or supplied_model is not null
            or supplied_latency_ms is not null or supplied_cost_micros is not null
        then raise invalid_parameter_value; end if;
        update public.transcripts set redacted_text = publication where id = item.transcript_id
        returning id into transcript;
    else
        if coalesce(btrim(supplied_raw_text), '') = '' or coalesce(btrim(supplied_provider), '') = ''
            or coalesce(btrim(supplied_model), '') = '' or supplied_latency_ms is null or supplied_latency_ms < 0
            or supplied_cost_micros is null or supplied_cost_micros < 0 then raise invalid_parameter_value; end if;
        insert into public.transcripts (answer_id, study_id, provider, model, latency_ms, cost_micros, redacted_text)
        values (supplied_answer_id, item.study_id, supplied_provider, supplied_model,
            supplied_latency_ms, supplied_cost_micros, publication)
        on conflict (answer_id) do update set provider = excluded.provider, model = excluded.model,
            latency_ms = excluded.latency_ms, cost_micros = excluded.cost_micros, redacted_text = excluded.redacted_text
        returning id into transcript;
        insert into pii.transcript_raw (transcript_id, raw_text) values (transcript, supplied_raw_text)
        on conflict (transcript_id) do update set raw_text = excluded.raw_text;
    end if;

    update internal.gate1_answer_jobs set result_status = result, completed_at = clock_timestamp(),
        completed_lease_id = job.lease_id, lease_id = null, lease_expires_at = null,
        source_hash = (select current_input.source_hash from internal.gate1_processing_input(supplied_answer_id) as current_input)
    where answer_id = supplied_answer_id;
    return jsonb_build_object('status', result, 'transcriptId', transcript);
end;
$$;

create function public.requeue_gate1_answer_job(supplied_answer_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
    if not internal.lock_gate1_processing_respondent(supplied_answer_id) then return false; end if;
    update internal.gate1_answer_jobs as job set result_status = null, completed_at = null,
        completed_lease_id = null, available_at = clock_timestamp()
    where job.answer_id = supplied_answer_id and job.result_status = 'private'
        and exists (select 1 from internal.gate1_processing_input(supplied_answer_id));
    return found;
end;
$$;

-- A later withdrawal or source revision hides completed Gate 1 rows on every read.
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
        where transcripts.id = target and transcripts.redacted_text is not null
            and respondents.status <> 'deleted' and internal.researches_study(transcripts.study_id)
            and internal.gate1_consent(respondents.id, transcripts.study_id, 'researcher_access')
            and (job.answer_id is null or (job.result_status = 'published' and exists (
                select 1 from internal.gate1_processing_input(answers.id) as item
                where item.source_hash = job.source_hash and item.processing_revision = job.processing_revision
                    and item.publication_revision = job.publication_revision
            )))
    );
$$;

revoke all on function internal.gate1_processing_input(uuid), internal.lock_gate1_processing_respondent(uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.claim_gate1_answer_job(uuid), public.validate_gate1_answer_job(uuid, uuid),
    public.retry_gate1_answer_job(uuid, uuid, integer),
    public.complete_gate1_answer_job(uuid, uuid, text, text, text, integer, bigint, text, boolean),
    public.requeue_gate1_answer_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_gate1_answer_job(uuid), public.validate_gate1_answer_job(uuid, uuid),
    public.retry_gate1_answer_job(uuid, uuid, integer),
    public.complete_gate1_answer_job(uuid, uuid, text, text, text, integer, bigint, text, boolean),
    public.requeue_gate1_answer_job(uuid) to service_role;
