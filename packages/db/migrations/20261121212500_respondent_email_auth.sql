create function public.provision_email_respondent(supplied_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    identity public.respondents%rowtype;
begin
    if not exists (
        select 1 from auth.users
        where id = supplied_user_id and email_confirmed_at is not null
            and email is not null and pg_catalog.btrim(email) <> ''
    ) or exists (select 1 from public.researchers where auth_user_id = supplied_user_id) then
        raise insufficient_privilege;
    end if;

    insert into public.respondents (auth_user_id, age_attested_at)
    values (supplied_user_id, now())
    on conflict (auth_user_id) do nothing;

    select respondents.* into strict identity from public.respondents
    where auth_user_id = supplied_user_id for update;

    if identity.status <> 'active' then
        raise insufficient_privilege;
    end if;

    return identity.id;
end;
$$;

revoke all on function public.provision_email_respondent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provision_email_respondent(uuid) to service_role;
