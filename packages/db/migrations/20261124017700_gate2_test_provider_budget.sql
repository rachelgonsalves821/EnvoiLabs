-- Checkout creation reserves one potential Stripe request; reconciliation
-- reserves its maximum three reads. The shared row is a conservative bound on
-- actual outbound requests, even when a path uses fewer than it reserved.
create table internal.gate2_test_provider_budgets (
    study_id uuid not null references public.studies(id),
    auth_user_id uuid not null references auth.users(id),
    window_start timestamptz not null,
    reserved_requests integer not null check (reserved_requests between 1 and 12),
    primary key (study_id, auth_user_id, window_start)
);
alter table internal.gate2_test_provider_budgets enable row level security;
revoke all on internal.gate2_test_provider_budgets from public, anon, authenticated, service_role;

create function public.consume_gate2_test_provider_budget(
    supplied_study_id uuid, supplied_auth_user_id uuid, requested_units integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    current_window timestamptz := date_trunc('hour', transaction_timestamp());
    new_count integer;
begin
    if requested_units not in (1, 3) or requested_units is null then
        return jsonb_build_object('status', 'blocked');
    end if;
    if not exists (
        select 1 from public.researchers as researcher
        join public.studies as study on study.organization_id = researcher.organization_id
        where researcher.auth_user_id = supplied_auth_user_id
            and study.id = supplied_study_id
    ) then return jsonb_build_object('status', 'blocked'); end if;

    insert into internal.gate2_test_provider_budgets
        (study_id, auth_user_id, window_start, reserved_requests)
    values (supplied_study_id, supplied_auth_user_id, current_window, requested_units)
    on conflict (study_id, auth_user_id, window_start)
    do update set reserved_requests =
        internal.gate2_test_provider_budgets.reserved_requests + requested_units
        where internal.gate2_test_provider_budgets.reserved_requests <= 12 - requested_units
    returning reserved_requests into new_count;
    if new_count is not null then
        return jsonb_build_object('status', 'allow', 'used', new_count);
    end if;
    return jsonb_build_object('status', 'limited',
        'retryAfterSeconds', greatest(1, ceil(extract(epoch from
            current_window + interval '1 hour' - transaction_timestamp()))::integer));
end;
$$;
revoke all on function public.consume_gate2_test_provider_budget(uuid, uuid, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.consume_gate2_test_provider_budget(uuid, uuid, integer) to service_role;
