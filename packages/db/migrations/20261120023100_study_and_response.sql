alter table public.respondents
    add column quality_level text not null default 'new',
    add column ytd_payout_cents integer not null default 0 check (ytd_payout_cents >= 0),
    add column referral_code text not null unique default gen_random_uuid()::text,
    add column whatsapp_waitlist_at timestamptz;

alter table pii.respondent_pii
    add column birth_year smallint check (birth_year >= 1900),
    add column device_fingerprints text[] not null default '{}';

create table public.pricing_configs (
    id uuid primary key default gen_random_uuid(),
    version integer not null unique check (version > 0),
    params_json jsonb not null check (jsonb_typeof(params_json) = 'object'),
    active boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index pricing_configs_one_active
    on public.pricing_configs (active) where active;

alter table public.organizations
    add column pricing_override_id uuid references public.pricing_configs (id);

create table public.studies (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations (id),
    title text not null check (btrim(title) <> ''),
    state text not null default 'draft' check (state in (
        'draft', 'scoping', 'brief_ready', 'awaiting_payment', 'fielding',
        'fieldwork_complete', 'analyzing', 'report_ready', 'closed', 'paused', 'cancelled'
    )),
    target_completes integer not null check (target_completes > 0),
    length_minutes integer not null check (length_minutes between 1 and 15),
    deadline_at timestamptz,
    labels jsonb not null default '[]' check (jsonb_typeof(labels) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index studies_by_organization on public.studies (organization_id);

create table public.profile_attributes (
    id uuid primary key default gen_random_uuid(),
    respondent_id uuid not null references public.respondents (id) on delete cascade,
    key text not null check (btrim(key) <> ''),
    value_json jsonb not null,
    source text not null check (source in ('signup', 'screener')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (respondent_id, key)
);

create table public.consents (
    id uuid primary key default gen_random_uuid(),
    respondent_id uuid not null references public.respondents (id) on delete cascade,
    study_id uuid references public.studies (id),
    purpose text not null check (purpose in (
        'recording', 'transcription_vendor', 'retention', 'researcher_access', 'voice_clip_sharing'
    )),
    granted boolean not null,
    text_version text not null check (btrim(text_version) <> ''),
    recorded_sequence bigint generated always as identity,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (purpose <> 'voice_clip_sharing' or study_id is not null)
);

create index consents_latest_by_purpose
    on public.consents (respondent_id, purpose, study_id, created_at desc, recorded_sequence desc);

create table public.brief_versions (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id) on delete cascade,
    version integer not null check (version > 0),
    brief_json jsonb not null check (jsonb_typeof(brief_json) = 'object'),
    created_by uuid not null references public.researchers (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (study_id, version)
);

create table public.criteria (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id) on delete cascade,
    kind text not null check (kind in ('must', 'nice', 'exclude')),
    attribute_key text not null,
    operator text not null,
    value_json jsonb not null,
    text text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.guide_questions (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id) on delete cascade,
    position integer not null check (position > 0),
    text text not null check (btrim(text) <> ''),
    max_probes integer not null default 2 check (max_probes between 0 and 2),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (study_id, position),
    unique (id, study_id)
);

create table public.invites (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null references public.studies (id),
    respondent_id uuid not null references public.respondents (id) on delete cascade,
    state text not null default 'matched' check (state in (
        'matched', 'screening', 'invited', 'accepted', 'declined', 'expired', 'screened_out'
    )),
    reward_cents integer not null check (reward_cents >= 0),
    expires_at timestamptz not null,
    why_you_text text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (study_id, respondent_id),
    unique (id, study_id)
);

create index invites_by_respondent on public.invites (respondent_id);

create table public.screener_answers (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null references public.invites (id) on delete cascade,
    key text not null,
    value_json jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (invite_id, key)
);

create table public.sessions (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null unique,
    study_id uuid not null,
    state text not null default 'started' check (state in (
        'started', 'in_progress', 'submitted', 'quality_hold', 'approved', 'removed', 'paid', 'abandoned'
    )),
    started_at timestamptz not null default now(),
    submitted_at timestamptz,
    liveness_phrase text,
    liveness_passed boolean,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, study_id),
    foreign key (invite_id, study_id) references public.invites (id, study_id) on delete cascade,
    check (submitted_at >= started_at)
);

create table pii.audio_objects (
    id uuid primary key default gen_random_uuid(),
    storage_path text not null unique,
    sha256 bytea not null check (octet_length(sha256) = 32),
    bytes integer not null check (bytes > 0),
    mime text not null,
    delete_after timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index audio_objects_by_hash on pii.audio_objects (sha256);

create table public.answers (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null,
    study_id uuid not null,
    guide_question_id uuid not null,
    probe_id uuid,
    kind text not null check (kind in ('voice', 'text')),
    audio_object_id uuid references pii.audio_objects (id) on delete set null,
    duration_ms integer check (duration_ms >= 0),
    sequence integer not null check (sequence > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (session_id, sequence),
    unique (id, session_id, guide_question_id),
    unique (id, study_id),
    foreign key (session_id, study_id) references public.sessions (id, study_id) on delete cascade,
    foreign key (guide_question_id, study_id) references public.guide_questions (id, study_id),
    check (kind = 'voice' or audio_object_id is null)
);

create table public.probes (
    id uuid primary key default gen_random_uuid(),
    answer_id uuid not null,
    session_id uuid not null,
    guide_question_id uuid not null,
    text text not null,
    decided_at timestamptz not null,
    shown_at timestamptz,
    latency_ms integer check (latency_ms >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, session_id, guide_question_id),
    foreign key (answer_id, session_id, guide_question_id)
        references public.answers (id, session_id, guide_question_id) on delete cascade
);

alter table public.answers add constraint answers_probe_in_session_question
    foreign key (probe_id, session_id, guide_question_id)
    references public.probes (id, session_id, guide_question_id);

create table public.transcripts (
    id uuid primary key default gen_random_uuid(),
    answer_id uuid not null unique,
    study_id uuid not null,
    redacted_text text,
    provider text not null,
    model text not null,
    latency_ms integer not null check (latency_ms >= 0),
    cost_micros bigint not null check (cost_micros >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, study_id),
    foreign key (answer_id, study_id) references public.answers (id, study_id) on delete cascade
);

create table pii.transcript_raw (
    id uuid primary key default gen_random_uuid(),
    transcript_id uuid not null unique references public.transcripts (id) on delete cascade,
    raw_text text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
declare
    relation regclass;
begin
    foreach relation in array array[
        'public.pricing_configs', 'public.studies', 'public.profile_attributes',
        'public.consents', 'public.brief_versions', 'public.criteria', 'public.guide_questions',
        'public.invites', 'public.screener_answers', 'public.sessions', 'pii.audio_objects',
        'public.answers', 'public.probes', 'public.transcripts', 'pii.transcript_raw'
    ]::regclass[] loop
        execute format('alter table %s enable row level security', relation);
        execute format('revoke all on table %s from public, anon, authenticated, service_role', relation);
        execute format('grant select, insert, update, delete on table %s to service_role', relation);
        execute format(
            'create trigger touch_updated_at before update on %s for each row execute function public.touch_updated_at()',
            relation
        );
    end loop;
end;
$$;
