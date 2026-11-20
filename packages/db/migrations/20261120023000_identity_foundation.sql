create schema pii;
revoke all on schema pii from public, anon, authenticated, service_role;
grant usage on schema pii to service_role;

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (btrim(name) <> ''),
    design_partner boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.researchers (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique references auth.users (id) on delete cascade,
    organization_id uuid not null references public.organizations (id),
    role text not null default 'member' check (role in ('member', 'admin')),
    terms_version text not null check (btrim(terms_version) <> ''),
    terms_accepted_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.respondents (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique references auth.users (id) on delete cascade,
    status text not null default 'active'
        check (status in ('active', 'paused', 'banned', 'deleted')),
    age_attested_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table pii.respondent_pii (
    respondent_id uuid primary key references public.respondents (id) on delete cascade,
    phone_e164_ciphertext bytea not null check (octet_length(phone_e164_ciphertext) > 0),
    phone_hash bytea not null unique check (octet_length(phone_hash) = 32),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    new.updated_at = statement_timestamp();
    return new;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

create trigger organizations_touch_updated_at
    before update on public.organizations
    for each row execute function public.touch_updated_at();

create trigger researchers_touch_updated_at
    before update on public.researchers
    for each row execute function public.touch_updated_at();

create trigger respondents_touch_updated_at
    before update on public.respondents
    for each row execute function public.touch_updated_at();

create trigger respondent_pii_touch_updated_at
    before update on pii.respondent_pii
    for each row execute function public.touch_updated_at();

alter table public.organizations enable row level security;
alter table public.researchers enable row level security;
alter table public.respondents enable row level security;
alter table pii.respondent_pii enable row level security;

-- Supabase projects may grant client roles privileges on new public tables by default.
revoke all on table public.organizations, public.researchers, public.respondents,
    pii.respondent_pii from public, anon, authenticated, service_role;
grant select on table public.organizations, public.researchers, public.respondents
    to authenticated;
grant select, insert, update, delete on table public.organizations, public.researchers,
    public.respondents, pii.respondent_pii to service_role;

create policy researchers_read_own_identity on public.researchers
    for select to authenticated
    using (
        auth_user_id = (select auth.uid())
        and (select auth.jwt() ->> 'aal') = 'aal2'
    );

create policy researchers_read_own_organization on public.organizations
    for select to authenticated
    using (
        (select auth.jwt() ->> 'aal') = 'aal2'
        and exists (
            select 1
            from public.researchers as membership
            where membership.organization_id = organizations.id
                and membership.auth_user_id = (select auth.uid())
        )
    );

create policy respondents_read_own_identity on public.respondents
    for select to authenticated
    using (auth_user_id = (select auth.uid()));
