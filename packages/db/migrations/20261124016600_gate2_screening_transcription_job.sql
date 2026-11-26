-- A confirmed screening recording is processed only under a current,
-- respondent-locked lease. A stale consent or rule never writes a transcript.
alter table internal.gate2_screening_audio_uploads
    add column available_at timestamptz not null default clock_timestamp(),
    add column attempts integer not null default 0 check (attempts >= 0),
    add column lease_id uuid,
    add column lease_expires_at timestamptz,
    add column recording_consent_id uuid references public.consents (id),
    add column transcription_consent_id uuid references public.consents (id),
    add column completed_at timestamptz,
    add column completed_lease_id uuid,
    add column receipt_id uuid unique references pii.gate2_screening_transcription_receipts (id),
    add check ((lease_id is null) = (lease_expires_at is null)),
    add check ((completed_at is null) = (receipt_id is null));

create index gate2_screening_audio_ready on internal.gate2_screening_audio_uploads
    (available_at, created_at, id)
    where confirmed_at is not null and completed_at is null;

create function internal.gate2_screening_audio_source(target_audio_id uuid)
returns table (recording_id uuid, transcription_id uuid, transcription_version text)
language sql volatile security definer set search_path = '' as $$
    select recording.id, transcription.id, transcription.text_version
    from internal.gate2_screening_audio_uploads as audio
    join public.respondents as respondent on respondent.id = audio.respondent_id
    join public.invites as offer on offer.id = audio.invite_id
        and offer.respondent_id = audio.respondent_id
    join public.studies as study on study.id = audio.study_id
    join lateral (select id from public.consents
        where respondent_id = audio.respondent_id
            and (study_id = audio.study_id or study_id is null)
            and purpose = 'recording'
        order by (study_id is not null) desc, created_at desc,
            recorded_sequence desc limit 1) as recording on true
    join lateral (select id, text_version from public.consents
        where respondent_id = audio.respondent_id
            and (study_id = audio.study_id or study_id is null)
            and purpose = 'transcription_vendor'
        order by (study_id is not null) desc, created_at desc,
            recorded_sequence desc limit 1) as transcription on true
    where audio.id = target_audio_id and audio.confirmed_at is not null
        and respondent.status = 'active' and offer.state = 'screening'
        and offer.expires_at > clock_timestamp() and study.state = 'fielding'
        and public.get_gate2_screening_rule(audio.rule_id,
            audio.study_id, audio.rule_version) is not null
        and internal.gate1_consent(audio.respondent_id, audio.study_id, 'retention')
        and internal.gate1_voice_allowed(audio.respondent_id, audio.study_id)
        and recording.id is not null and transcription.id is not null;
$$;
revoke all on function internal.gate2_screening_audio_source(uuid)
    from public, anon, authenticated, service_role;

create function internal.gate2_lock_screening_audio(target_audio_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target internal.gate2_screening_audio_uploads%rowtype;
begin
    select * into target from internal.gate2_screening_audio_uploads
        where id = target_audio_id;
    if not found then return false; end if;
    perform 1 from public.studies where id = target.study_id for update;
    perform 1 from public.respondents where id = target.respondent_id for update;
    perform 1 from internal.gate2_screening_audio_uploads where id = target.id for update;
    return found;
end;
$$;
revoke all on function internal.gate2_lock_screening_audio(uuid)
    from public, anon, authenticated, service_role;

create function public.claim_gate2_screening_audio(supplied_audio_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
declare job internal.gate2_screening_audio_uploads%rowtype;
declare source record;
begin
    select audio.id into target_id from internal.gate2_screening_audio_uploads as audio
    where (supplied_audio_id is null or audio.id = supplied_audio_id)
        and audio.confirmed_at is not null and audio.completed_at is null
        and audio.available_at <= clock_timestamp()
        and (audio.lease_id is null or audio.lease_expires_at <= clock_timestamp())
    order by audio.available_at, audio.created_at, audio.id limit 1;
    if not found or not internal.gate2_lock_screening_audio(target_id) then return null; end if;
    select * into job from internal.gate2_screening_audio_uploads where id = target_id;
    if job.completed_at is not null or job.available_at > clock_timestamp()
        or job.lease_expires_at > clock_timestamp() then return null; end if;
    select * into source from internal.gate2_screening_audio_source(target_id);
    if not found then return null; end if;
    if exists (select 1 from pii.gate2_screener_answers as previous
        where previous.invite_id = job.invite_id and previous.rule_id = job.rule_id
            and previous.rule_version = job.rule_version
            and not exists (select 1 from public.gate2_screening_events as decision
                where decision.answer_id = previous.id and decision.action = 'clarify'))
    then return null; end if;
    update internal.gate2_screening_audio_uploads
    set lease_id = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '2 minutes',
        attempts = attempts + 1, recording_consent_id = source.recording_id,
        transcription_consent_id = source.transcription_id
    where id = target_id returning * into job;
    return jsonb_build_object('audioObjectId', job.id, 'leaseId', job.lease_id,
        'storagePath', 'screening/' || job.invite_id || '/' || job.id,
        'bytes', job.bytes, 'mime', job.mime, 'sha256', job.sha256,
        'durationMs', job.duration_ms, 'attempts', job.attempts);
end;
$$;

create function public.validate_gate2_screening_audio(
    supplied_audio_id uuid, supplied_lease_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare job internal.gate2_screening_audio_uploads%rowtype;
declare source record;
begin
    if not internal.gate2_lock_screening_audio(supplied_audio_id) then return false; end if;
    select * into job from internal.gate2_screening_audio_uploads
        where id = supplied_audio_id;
    select * into source from internal.gate2_screening_audio_source(supplied_audio_id);
    if not found then return false; end if;
    return job.lease_id = supplied_lease_id
        and job.lease_expires_at > clock_timestamp() and job.completed_at is null
        and job.recording_consent_id = source.recording_id
        and job.transcription_consent_id = source.transcription_id;
end;
$$;

create function public.retry_gate2_screening_audio(
    supplied_audio_id uuid, supplied_lease_id uuid,
    supplied_delay_seconds integer default 30
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
    if supplied_delay_seconds not between 0 and 3600 then raise invalid_parameter_value; end if;
    if not internal.gate2_lock_screening_audio(supplied_audio_id) then return false; end if;
    update internal.gate2_screening_audio_uploads
    set lease_id = null, lease_expires_at = null,
        available_at = clock_timestamp() + make_interval(secs => supplied_delay_seconds)
    where id = supplied_audio_id and lease_id = supplied_lease_id
        and lease_expires_at > clock_timestamp() and completed_at is null;
    return found;
end;
$$;

create function public.complete_gate2_screening_audio(
    supplied_audio_id uuid, supplied_lease_id uuid,
    supplied_text text, supplied_provider text, supplied_model text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare job internal.gate2_screening_audio_uploads%rowtype;
declare source record;
declare receipt uuid;
declare answer jsonb;
begin
    if not internal.gate2_lock_screening_audio(supplied_audio_id)
    then return jsonb_build_object('status', 'stale'); end if;
    select * into job from internal.gate2_screening_audio_uploads
        where id = supplied_audio_id;
    select * into source from internal.gate2_screening_audio_source(supplied_audio_id);
    if not found or source.recording_id is distinct from job.recording_consent_id
        or source.transcription_id is distinct from job.transcription_consent_id
    then return jsonb_build_object('status', 'stale'); end if;
    if job.completed_at is not null then
        return jsonb_build_object('status', case when job.completed_lease_id = supplied_lease_id
            then 'alreadyCompleted' else 'stale' end, 'receiptId', job.receipt_id);
    end if;
    if job.lease_id is distinct from supplied_lease_id
        or job.lease_expires_at <= clock_timestamp()
    then return jsonb_build_object('status', 'stale'); end if;
    if nullif(btrim(supplied_text), '') is null or length(supplied_text) > 2000
        or nullif(btrim(supplied_provider), '') is null
        or nullif(btrim(supplied_model), '') is null
    then raise invalid_parameter_value; end if;
    if exists (select 1 from pii.gate2_screener_answers as previous
        where previous.invite_id = job.invite_id and previous.rule_id = job.rule_id
            and previous.rule_version = job.rule_version
            and not exists (select 1 from public.gate2_screening_events as decision
                where decision.answer_id = previous.id and decision.action = 'clarify'))
    then return jsonb_build_object('status', 'stale'); end if;
    insert into pii.gate2_screening_transcription_receipts
        (invite_id, study_id, respondent_id, rule_id, rule_version,
        audio_object_id, audio_storage_path, audio_bytes, audio_mime,
        duration_ms, audio_sha256, provider, model, transcript_text,
        recording_consent_id, transcription_consent_id,
        transcription_consent_version)
    values (job.invite_id, job.study_id, job.respondent_id, job.rule_id,
        job.rule_version, job.id, 'screening/' || job.invite_id || '/' || job.id,
        job.bytes, job.mime, job.duration_ms, job.sha256,
        supplied_provider, supplied_model, supplied_text,
        source.recording_id, source.transcription_id,
        source.transcription_version) returning id into receipt;
    answer := public.store_gate2_screening_transcribed_answer(
        receipt, 'screening:audio:' || job.id);
    update internal.gate2_screening_audio_uploads
    set completed_at = clock_timestamp(), completed_lease_id = job.lease_id,
        receipt_id = receipt, lease_id = null, lease_expires_at = null
    where id = job.id;
    return jsonb_build_object('status', 'completed', 'receiptId', receipt,
        'answerId', answer ->> 'id');
end;
$$;

revoke all on function public.claim_gate2_screening_audio(uuid),
    public.validate_gate2_screening_audio(uuid,uuid),
    public.retry_gate2_screening_audio(uuid,uuid,integer),
    public.complete_gate2_screening_audio(uuid,uuid,text,text,text)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_gate2_screening_audio(uuid),
    public.validate_gate2_screening_audio(uuid,uuid),
    public.retry_gate2_screening_audio(uuid,uuid,integer),
    public.complete_gate2_screening_audio(uuid,uuid,text,text,text)
    to service_role;
