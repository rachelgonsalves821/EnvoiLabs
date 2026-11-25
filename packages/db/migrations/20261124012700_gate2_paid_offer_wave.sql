-- A signed provider event has no researcher identity. This service-only entry
-- selects a current study member, then reuses the exact paid-quote marketplace
-- matcher. The underlying matcher serializes study/respondent capacity.
create function public.create_gate2_paid_launch_wave(
    supplied_study_id uuid, supplied_quote_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    member_auth_id uuid;
begin
    select * into target from public.studies
        where id = supplied_study_id;
    if not found or target.state <> 'fielding'
    then raise check_violation; end if;
    select researcher.auth_user_id into member_auth_id
    from public.researchers as researcher
    where researcher.organization_id = target.organization_id
    order by (researcher.role = 'admin') desc, researcher.id limit 1;
    if member_auth_id is null then raise check_violation; end if;
    return public.create_gate2_marketplace_offers(target.id, supplied_quote_id,
        member_auth_id, least(target.target_completes, 100));
end;
$$;
revoke all on function public.create_gate2_paid_launch_wave(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.create_gate2_paid_launch_wave(uuid, uuid)
    to service_role;
