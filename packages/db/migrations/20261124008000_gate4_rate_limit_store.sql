-- Preview-only quota policy. A separate reviewed configuration change must
-- enable a policy; caller-supplied limits never become authority by themselves.
create table internal.gate4_rate_policies (
    surface text not null,
    key_kind text not null,
    max_attempts integer not null check (max_attempts between 1 and 100000),
    window_seconds integer not null check (window_seconds between 1 and 86400),
    enabled boolean not null default false,
    primary key (surface, key_kind),
    check ((surface = 'email-start' and key_kind in ('email', 'source'))
        or (surface = 'audio-upload' and key_kind in ('respondent', 'source')))
);
alter table internal.gate4_rate_policies enable row level security;
revoke all on internal.gate4_rate_policies from public, anon, authenticated, service_role;
insert into internal.gate4_rate_policies
    (surface, key_kind, max_attempts, window_seconds) values
    ('email-start', 'email', 5, 3600),
    ('email-start', 'source', 20, 3600),
    ('audio-upload', 'respondent', 10, 3600),
    ('audio-upload', 'source', 30, 3600);

create table internal.gate4_rate_windows (
    surface text not null,
    key_kind text not null,
    key_digest text not null check (key_digest ~ '^[0-9a-f]{64}$'),
    window_start timestamptz not null,
    attempts integer not null check (attempts >= 0),
    expires_at timestamptz not null,
    primary key (surface, key_kind, key_digest, window_start),
    check ((surface = 'email-start' and key_kind in ('email', 'source'))
        or (surface = 'audio-upload' and key_kind in ('respondent', 'source'))),
    check (expires_at > window_start)
);
alter table internal.gate4_rate_windows enable row level security;
revoke all on internal.gate4_rate_windows from public, anon, authenticated, service_role;

create function public.consume_gate4_rate_limit(requested_rules jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    rule jsonb;
    item record;
    policy internal.gate4_rate_policies%rowtype;
    at_time timestamptz;
    start_time timestamptz;
    current_attempts integer;
    retry_seconds integer := 0;
    requested_surface text;
    identity_kind text;
    rule_count integer;
    chosen_max integer;
    chosen_window integer;
begin
    if jsonb_typeof(requested_rules) is distinct from 'array'
        or jsonb_array_length(requested_rules) <> 2 then raise check_violation; end if;
    requested_surface := requested_rules -> 0 ->> 'surface';
    identity_kind := case requested_surface
        when 'email-start' then 'email' when 'audio-upload' then 'respondent'
        else null end;
    if identity_kind is null then raise check_violation; end if;
    select count(distinct entry.value ->> 'key_kind') into rule_count
    from jsonb_array_elements(requested_rules) as entry(value);
    if rule_count <> 2 then raise check_violation; end if;

    for rule in select value from jsonb_array_elements(requested_rules) loop
        if jsonb_typeof(rule) is distinct from 'object'
            or rule ->> 'surface' is distinct from requested_surface
            or rule ->> 'key_kind' not in (identity_kind, 'source')
            or coalesce(rule ->> 'key_digest', '') !~ '^[0-9a-f]{64}$'
            or coalesce(rule ->> 'max_attempts', '') !~ '^[1-9][0-9]{0,5}$'
            or coalesce(rule ->> 'window_seconds', '') !~ '^[1-9][0-9]{0,4}$'
        then raise check_violation; end if;
        chosen_max := (rule ->> 'max_attempts')::integer;
        chosen_window := (rule ->> 'window_seconds')::integer;
        if chosen_max > 100000 or chosen_window > 86400 then raise check_violation; end if;
        select * into policy from internal.gate4_rate_policies
        where surface = requested_surface and key_kind = rule ->> 'key_kind';
        if not found or not policy.enabled or policy.max_attempts <> chosen_max
            or policy.window_seconds <> chosen_window then raise check_violation; end if;
    end loop;

    -- A collision only adds contention. Sorting the full identities prevents
    -- opposite-order requests from deadlocking or bypassing the shared key.
    for item in select value ->> 'surface' as surface,
            value ->> 'key_kind' as key_kind, value ->> 'key_digest' as key_digest
        from jsonb_array_elements(requested_rules)
        order by surface, key_kind, key_digest
    loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            item.surface || ':' || item.key_kind || ':' || item.key_digest, 0));
    end loop;
    at_time := pg_catalog.clock_timestamp();
    for item in select value ->> 'surface' as surface,
            value ->> 'key_kind' as key_kind, value ->> 'key_digest' as key_digest,
            (value ->> 'max_attempts')::integer as max_attempts,
            (value ->> 'window_seconds')::integer as window_seconds
        from jsonb_array_elements(requested_rules)
    loop
        start_time := pg_catalog.to_timestamp(pg_catalog.floor(
            extract(epoch from at_time) / item.window_seconds)
            * item.window_seconds);
        select attempts into current_attempts from internal.gate4_rate_windows
        where surface = item.surface and key_kind = item.key_kind
            and key_digest = item.key_digest and window_start = start_time;
        if coalesce(current_attempts, 0) >= item.max_attempts then
            retry_seconds := greatest(retry_seconds,
                pg_catalog.ceil(extract(epoch from
                    start_time + pg_catalog.make_interval(secs => item.window_seconds)
                    - at_time))::integer);
        end if;
    end loop;
    if retry_seconds > 0 then
        return jsonb_build_object('allowed', false,
            'retry_after_seconds', greatest(1, retry_seconds));
    end if;
    for item in select value ->> 'surface' as surface,
            value ->> 'key_kind' as key_kind, value ->> 'key_digest' as key_digest,
            (value ->> 'window_seconds')::integer as window_seconds
        from jsonb_array_elements(requested_rules)
    loop
        start_time := pg_catalog.to_timestamp(pg_catalog.floor(
            extract(epoch from at_time) / item.window_seconds)
            * item.window_seconds);
        insert into internal.gate4_rate_windows
            (surface, key_kind, key_digest, window_start, attempts, expires_at)
        values (item.surface, item.key_kind, item.key_digest, start_time, 1,
            start_time + pg_catalog.make_interval(secs => item.window_seconds))
        on conflict (surface, key_kind, key_digest, window_start)
        do update set attempts = internal.gate4_rate_windows.attempts + 1;
    end loop;
    return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.consume_gate4_rate_limit(jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.consume_gate4_rate_limit(jsonb) to service_role;
