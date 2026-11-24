-- Approved rules and raw answers are private. Decisions are append-only evidence.
alter table public.criteria add constraint criteria_id_study_unique unique (id, study_id);

create table public.gate2_screening_rules (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null,
    criterion_id uuid not null,
    version integer not null check (version > 0),
    criterion_kind text not null check (criterion_kind in ('must', 'nice', 'exclude')),
    question text not null check (btrim(question) <> ''),
    approved_by uuid not null references public.researchers (id),
    approved_at timestamptz not null,
    created_at timestamptz not null default now(),
    foreign key (criterion_id, study_id) references public.criteria (id, study_id),
    unique (criterion_id, version),
    unique (id, study_id, version)
);

create table pii.gate2_screener_answers (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null,
    study_id uuid not null,
    rule_id uuid not null,
    rule_version integer not null,
    kind text not null check (kind in ('text', 'voice')),
    answer_text text not null check (btrim(answer_text) <> ''),
    transcription_consent_version text,
    idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
    created_at timestamptz not null default now(),
    foreign key (invite_id, study_id) references public.invites (id, study_id),
    foreign key (rule_id, study_id, rule_version)
        references public.gate2_screening_rules (id, study_id, version),
    check (kind <> 'voice' or btrim(coalesce(transcription_consent_version, '')) <> ''),
    unique (id, rule_id, rule_version)
);

create table public.gate2_screening_events (
    id uuid primary key default gen_random_uuid(),
    answer_id uuid not null,
    rule_id uuid not null,
    rule_version integer not null,
    interpretation text check (interpretation in ('supported', 'contradicted', 'unclear')),
    start_char integer check (start_char >= 0),
    end_char integer check (end_char > start_char),
    action text not null check (action in ('qualify', 'screen_out', 'clarify', 'review')),
    confirmed_fact boolean,
    created_at timestamptz not null default now(),
    foreign key (answer_id, rule_id, rule_version)
        references pii.gate2_screener_answers (id, rule_id, rule_version),
    unique (answer_id, rule_id),
    check ((start_char is null) = (end_char is null)),
    check ((action in ('qualify', 'screen_out')) = (confirmed_fact is not null)),
    check (action not in ('qualify', 'screen_out') or
        (interpretation in ('supported', 'contradicted') and start_char is not null))
);

do $$
declare relation regclass;
begin
    foreach relation in array array[
        'public.gate2_screening_rules', 'pii.gate2_screener_answers',
        'public.gate2_screening_events'
    ]::regclass[] loop
        execute format('alter table %s enable row level security', relation);
        execute format('revoke all on table %s from public, anon, authenticated, service_role', relation);
        execute format('grant select, insert on table %s to service_role', relation);
        execute format('create trigger immutable_gate2_screening before update or delete on %s '
            || 'for each row execute function internal.reject_gate2_ledger_mutation()', relation);
    end loop;
end;
$$;

create function internal.check_gate2_screening_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    source_text text;
    rule_kind text;
begin
    select answer_text into source_text from pii.gate2_screener_answers where id = new.answer_id;
    select criterion_kind into rule_kind from public.gate2_screening_rules where id = new.rule_id;
    if source_text is null or rule_kind is null then raise foreign_key_violation; end if;
    if new.start_char is not null and (new.end_char > length(source_text)
        or btrim(substr(source_text, new.start_char + 1, new.end_char - new.start_char)) = '')
    then raise check_violation; end if;
    if new.action in ('qualify', 'screen_out') then
        if new.confirmed_fact is distinct from (new.interpretation = 'supported') then raise check_violation; end if;
        if (new.action = 'screen_out') is distinct from
            ((rule_kind = 'must' and new.interpretation = 'contradicted') or
             (rule_kind = 'exclude' and new.interpretation = 'supported'))
        then raise check_violation; end if;
    end if;
    return new;
end;
$$;
revoke all on function internal.check_gate2_screening_event() from public, anon, authenticated, service_role;
create trigger validate_gate2_screening_event before insert on public.gate2_screening_events
    for each row execute function internal.check_gate2_screening_event();
