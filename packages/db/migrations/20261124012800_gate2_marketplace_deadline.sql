-- A paid marketplace quote must have a usable fieldwork deadline before any
-- Checkout Session is created. The same rule is rechecked on paid launch.
create function internal.gate2_require_quote_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if exists (select 1 from public.pricing_configs
        where id = new.pricing_config_id and marketplace_active)
        and not exists (select 1 from public.studies as study
            where study.id = new.study_id
                and study.deadline_at > clock_timestamp())
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_require_quote_deadline()
    from public, anon, authenticated, service_role;
create trigger gate2_require_quote_deadline
    before insert on public.gate2_quote_snapshots
    for each row execute function internal.gate2_require_quote_deadline();

create function internal.gate2_require_checkout_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if exists (select 1 from public.gate2_quote_snapshots as frozen
        where frozen.id = new.quote_id and frozen.pricing_config_version >= 101)
        and not exists (select 1 from public.studies as study
            where study.id = new.study_id
                and study.deadline_at > clock_timestamp())
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_require_checkout_deadline()
    from public, anon, authenticated, service_role;
create trigger gate2_require_checkout_deadline
    before insert or update on internal.gate2_checkout_intents
    for each row execute function internal.gate2_require_checkout_deadline();

-- Protect the table transition too, including any caller of the earlier
-- privileged launch routine. The wrapper below reports stale scope as false.
create function internal.gate2_guard_fielding_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.state = 'awaiting_payment' and new.state = 'fielding'
        and exists (select 1 from public.gate2_quote_snapshots as frozen
            where frozen.study_id = old.id and frozen.pricing_config_version >= 101)
        and (old.deadline_at is null or old.deadline_at <= clock_timestamp())
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_fielding_deadline()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_fielding_deadline
    before update of state on public.studies
    for each row execute function internal.gate2_guard_fielding_deadline();

create function public.launch_gate2_paid_study_checked(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_provider_event_id text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
begin
    select * into target from public.studies
        where id = supplied_study_id for update;
    if not found then return false; end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = supplied_quote_id and study_id = target.id for share;
    if not found then return false; end if;
    if frozen.pricing_config_version >= 101 and
        (target.deadline_at is null or target.deadline_at <= clock_timestamp())
    then return false; end if;
    return public.launch_gate2_paid_study(supplied_study_id,
        supplied_quote_id, supplied_provider_event_id);
end;
$$;
revoke all on function public.launch_gate2_paid_study_checked(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.launch_gate2_paid_study_checked(uuid, uuid, text)
    to service_role;
