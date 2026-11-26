-- A private, consent-bound upload lease for a screening answer. Confirmation
-- is service-only after the server verifies the stored bytes and container.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gate2-screening-audio', 'gate2-screening-audio', false, 20971520,
    array['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table internal.gate2_screening_audio_uploads (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null,
    study_id uuid not null,
    respondent_id uuid not null references public.respondents (id),
    rule_id uuid not null,
    rule_version integer not null,
    bytes integer not null check (bytes between 1 and 20971520),
    mime text not null check (mime in ('audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg')),
    expires_at timestamptz not null,
    duration_ms integer check (duration_ms between 1 and 180000),
    sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
    confirmed_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    foreign key (invite_id, study_id) references public.invites (id, study_id),
    foreign key (rule_id, study_id, rule_version)
        references public.gate2_screening_rules (id, study_id, version),
    check ((confirmed_at is null and duration_ms is null and sha256 is null)
        or (confirmed_at is not null and duration_ms is not null and sha256 is not null))
);
alter table internal.gate2_screening_audio_uploads enable row level security;
revoke all on internal.gate2_screening_audio_uploads from public, anon, authenticated, service_role;

create function public.reserve_gate2_screening_audio(
    supplied_invite_id uuid, supplied_rule_id uuid, supplied_version integer,
    supplied_bytes integer, supplied_mime text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid;
    offer public.invites%rowtype;
    reservation internal.gate2_screening_audio_uploads%rowtype;
    study_id uuid;
begin
    if supplied_bytes not between 1 and 20971520 or supplied_mime not in
        ('audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg')
    then raise check_violation; end if;
    select candidate.study_id into study_id from public.invites as candidate
        where candidate.id = supplied_invite_id;
    if study_id is null then raise insufficient_privilege; end if;
    perform 1 from public.studies where id = study_id and state = 'fielding' for update;
    if not found then raise insufficient_privilege; end if;
    owner_id := internal.lock_active_respondent();
    select * into offer from public.invites where id = supplied_invite_id
        and respondent_id = owner_id for update;
    if not found or offer.state <> 'screening'
        or offer.expires_at <= clock_timestamp()
        or public.get_gate2_screening_rule(supplied_rule_id,
            offer.study_id, supplied_version) is null
        or not internal.gate1_consent(owner_id, offer.study_id, 'retention')
        or not internal.gate1_voice_allowed(owner_id, offer.study_id)
    then raise insufficient_privilege; end if;
    insert into internal.gate2_screening_audio_uploads (invite_id, study_id,
        respondent_id, rule_id, rule_version, bytes, mime, expires_at)
    values (offer.id, offer.study_id, owner_id, supplied_rule_id,
        supplied_version, supplied_bytes, supplied_mime,
        least(clock_timestamp() + interval '10 minutes', offer.expires_at))
    returning * into reservation;
    return jsonb_build_object('audioObjectId', reservation.id,
        'expiresAt', reservation.expires_at);
end;
$$;
revoke all on function public.reserve_gate2_screening_audio(uuid,uuid,integer,integer,text)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_screening_audio(uuid,uuid,integer,integer,text)
    to authenticated;

create function public.read_gate2_screening_audio_reservation(
    supplied_invite_id uuid, supplied_audio_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    reservation internal.gate2_screening_audio_uploads%rowtype;
begin
    select * into reservation from internal.gate2_screening_audio_uploads
        where id = supplied_audio_id and invite_id = supplied_invite_id
            and respondent_id = owner_id;
    if not found or (reservation.confirmed_at is null
        and reservation.expires_at <= clock_timestamp())
        or not internal.gate1_consent(owner_id, reservation.study_id, 'retention')
        or not internal.gate1_voice_allowed(owner_id, reservation.study_id)
    then raise insufficient_privilege; end if;
    return jsonb_build_object('ownerId', owner_id, 'bytes', reservation.bytes,
        'mime', reservation.mime, 'ruleId', reservation.rule_id,
        'ruleVersion', reservation.rule_version, 'confirmed', reservation.confirmed_at is not null);
end;
$$;
revoke all on function public.read_gate2_screening_audio_reservation(uuid,uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_screening_audio_reservation(uuid,uuid)
    to authenticated;

create function public.confirm_gate2_screening_audio(
    supplied_owner_id uuid, supplied_invite_id uuid, supplied_audio_id uuid,
    supplied_duration_ms integer, supplied_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    reservation internal.gate2_screening_audio_uploads%rowtype;
    offer public.invites%rowtype;
    requested_study_id uuid;
begin
    if supplied_duration_ms not between 1 and 180000
        or supplied_sha256 !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
    select study_id into requested_study_id from public.invites
        where id = supplied_invite_id and respondent_id = supplied_owner_id;
    if requested_study_id is null then raise insufficient_privilege; end if;
    perform 1 from public.studies where id = requested_study_id
        and state = 'fielding' for update;
    if not found then raise check_violation; end if;
    perform 1 from public.respondents where id = supplied_owner_id
        and status = 'active' for update;
    if not found then raise insufficient_privilege; end if;
    select * into reservation from internal.gate2_screening_audio_uploads
        where id = supplied_audio_id and invite_id = supplied_invite_id
            and respondent_id = supplied_owner_id for update;
    if not found then raise insufficient_privilege; end if;
    select * into offer from public.invites where id = supplied_invite_id for update;
    if not found or not internal.gate1_consent(supplied_owner_id, reservation.study_id, 'retention')
        or not internal.gate1_voice_allowed(supplied_owner_id, reservation.study_id)
    then raise check_violation; end if;
    if reservation.confirmed_at is not null then
        if reservation.duration_ms <> supplied_duration_ms
            or reservation.sha256 <> supplied_sha256 then raise unique_violation; end if;
    elsif offer.state <> 'screening' or reservation.expires_at <= clock_timestamp()
        or public.get_gate2_screening_rule(reservation.rule_id,
            reservation.study_id, reservation.rule_version) is null
    then raise check_violation;
    else
        update internal.gate2_screening_audio_uploads
        set duration_ms = supplied_duration_ms, sha256 = supplied_sha256,
            confirmed_at = clock_timestamp() where id = reservation.id;
    end if;
    return jsonb_build_object('audioObjectId', reservation.id, 'status', 'queued');
end;
$$;
revoke all on function public.confirm_gate2_screening_audio(uuid,uuid,uuid,integer,text)
    from public, anon, authenticated, service_role;
grant execute on function public.confirm_gate2_screening_audio(uuid,uuid,uuid,integer,text)
    to service_role;
