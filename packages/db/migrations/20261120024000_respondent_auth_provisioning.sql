create function public.provision_respondent(
    supplied_user_id uuid,
    supplied_ciphertext bytea,
    supplied_hash bytea
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
    identity public.respondents%rowtype;
begin
    if exists (select 1 from public.researchers where auth_user_id = supplied_user_id) then
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

    insert into pii.respondent_pii (respondent_id, phone_e164_ciphertext, phone_hash)
    values (identity.id, supplied_ciphertext, supplied_hash)
    on conflict (respondent_id) do nothing;

    if not exists (
        select 1 from pii.respondent_pii
        where respondent_id = identity.id and phone_hash = supplied_hash
    ) then
        raise insufficient_privilege;
    end if;

    return identity.id;
end;
$$;

revoke all on function public.provision_respondent(uuid, bytea, bytea)
from public, anon, authenticated, service_role;
grant execute on function public.provision_respondent(uuid, bytea, bytea) to service_role;
