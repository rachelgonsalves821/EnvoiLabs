-- A subscription is private transport material, never a consent grant.
-- The sender remains disabled and must recheck consent before delivery.
revoke all on public.push_subscriptions from public, anon, authenticated, service_role;
grant select on public.push_subscriptions to service_role;

create function public.register_gate2_push_subscription(
    supplied_endpoint text, supplied_p256dh text, supplied_auth text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    prior public.push_subscriptions%rowtype;
begin
    if not internal.gate1_consent(owner_id, null, 'push_notifications')
        or supplied_endpoint is null or length(supplied_endpoint) > 2048
        or supplied_endpoint !~ '^https://[^/?# ]+/.+'
        or supplied_p256dh !~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
        or supplied_auth !~ '^[A-Za-z0-9_-]{20,32}={0,2}$'
    then raise check_violation; end if;
    select * into prior from public.push_subscriptions
        where endpoint = supplied_endpoint for update;
    if found and prior.respondent_id <> owner_id then raise insufficient_privilege; end if;
    if not found and (select count(*) from public.push_subscriptions
        where respondent_id = owner_id) >= 3 then raise check_violation; end if;
    insert into public.push_subscriptions
        (respondent_id, endpoint, keys_json, platform)
    values (owner_id, supplied_endpoint, jsonb_build_object(
        'p256dh', supplied_p256dh, 'auth', supplied_auth), 'web')
    on conflict (endpoint) do update set keys_json = excluded.keys_json,
        updated_at = clock_timestamp();
    return true;
end;
$$;
revoke all on function public.register_gate2_push_subscription(text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.register_gate2_push_subscription(text, text, text)
    to authenticated;

create function public.remove_gate2_push_subscription(supplied_endpoint text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := internal.lock_active_respondent();
begin
    delete from public.push_subscriptions
    where endpoint = supplied_endpoint and respondent_id = owner_id;
    return found;
end;
$$;
revoke all on function public.remove_gate2_push_subscription(text)
    from public, anon, authenticated, service_role;
grant execute on function public.remove_gate2_push_subscription(text)
    to authenticated;
