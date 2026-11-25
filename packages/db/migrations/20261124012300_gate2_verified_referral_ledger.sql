-- Email-confirmed, complete self-service profiles count toward one $5
-- threshold. This ledger never creates a payout or contacts a provider.
create table public.gate2_referral_profile_verifications (
    id uuid primary key default gen_random_uuid(),
    referral_id uuid not null unique references public.referrals (id),
    referrer_id uuid not null references public.respondents (id),
    referee_id uuid not null unique references public.respondents (id),
    normalized_email_hash bytea not null unique
        check (octet_length(normalized_email_hash) = 32),
    profile_digest bytea not null check (octet_length(profile_digest) = 32),
    verified_at timestamptz not null default clock_timestamp(),
    check (referrer_id <> referee_id)
);
create table public.gate2_referral_vestings (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null unique references public.respondents (id),
    verified_profile_count integer not null check (verified_profile_count = 5),
    bonus_cents integer not null check (bonus_cents = 500),
    idempotency_key text not null unique,
    vested_at timestamptz not null default clock_timestamp()
);
alter table public.gate2_referral_profile_verifications enable row level security;
alter table public.gate2_referral_vestings enable row level security;
revoke all on public.gate2_referral_profile_verifications,
    public.gate2_referral_vestings from public, anon, authenticated, service_role;
grant select on public.gate2_referral_profile_verifications,
    public.gate2_referral_vestings to service_role;
create trigger immutable_gate2_referral_verification
    before update or delete on public.gate2_referral_profile_verifications
    for each row execute function internal.reject_gate2_ledger_mutation();
create trigger immutable_gate2_referral_vesting
    before update or delete on public.gate2_referral_vestings
    for each row execute function internal.reject_gate2_ledger_mutation();

create function internal.gate2_keep_referral_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.referrer_id is distinct from old.referrer_id
        or new.referee_id is distinct from old.referee_id
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_keep_referral_identity()
    from public, anon, authenticated, service_role;
create trigger gate2_keep_referral_identity
    before update of referrer_id, referee_id on public.referrals
    for each row execute function internal.gate2_keep_referral_identity();

create function public.register_gate2_referral(supplied_referral_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    referee public.respondents%rowtype;
    referrer public.respondents%rowtype;
    saved public.referrals%rowtype;
begin
    select respondent.* into referee from public.respondents as respondent
    join auth.users as account on account.id = respondent.auth_user_id
    where respondent.auth_user_id = auth.uid() and respondent.status = 'active'
        and account.email_confirmed_at is not null;
    select respondent.* into referrer from public.respondents as respondent
    where respondent.referral_code = supplied_referral_code
        and respondent.status = 'active';
    if referee.id is null or referrer.id is null or referee.id = referrer.id
    then raise check_violation; end if;
    insert into public.referrals (referrer_id, referee_id, state)
    values (referrer.id, referee.id, 'profile_pending')
    on conflict (referee_id) do nothing;
    select * into saved from public.referrals where referee_id = referee.id;
    if saved.referrer_id is distinct from referrer.id then raise check_violation; end if;
    return saved.id;
end;
$$;
revoke all on function public.register_gate2_referral(text)
    from public, anon, authenticated, service_role;
grant execute on function public.register_gate2_referral(text) to authenticated;

create function public.verify_gate2_referred_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    referred public.referrals%rowtype;
    referrer public.respondents%rowtype;
    referee public.respondents%rowtype;
    account auth.users%rowtype;
    profile_count integer;
    profile_hash bytea;
    saved public.gate2_referral_profile_verifications%rowtype;
    verified_count integer;
    vested public.gate2_referral_vestings%rowtype;
begin
    select referral.* into referred from public.referrals as referral
    join public.respondents as respondent on respondent.id = referral.referee_id
    where respondent.auth_user_id = auth.uid();
    if not found then raise check_violation; end if;
    select * into referrer from public.respondents
        where id = referred.referrer_id for update;
    select * into referee from public.respondents
        where id = referred.referee_id for update;
    select * into account from auth.users where id = referee.auth_user_id;
    if referrer.status <> 'active' or referee.status <> 'active'
        or account.email_confirmed_at is null
        or nullif(btrim(account.email), '') is null
    then raise check_violation; end if;
    select count(distinct fact.key), sha256(convert_to(string_agg(
        fact.key || '=' || fact.value_json::text, '|' order by fact.key), 'UTF8'))
    into profile_count, profile_hash
    from public.profile_attributes as fact
    where fact.respondent_id = referee.id and fact.source = 'signup'
        and fact.key = any(array['age_range', 'gender', 'student_year',
            'lives_on_campus', 'online_shopping_frequency', 'region_zip',
            'food_orders_per_week', 'interests']);
    if profile_count <> 8 then raise check_violation; end if;
    insert into public.gate2_referral_profile_verifications
        (referral_id, referrer_id, referee_id,
            normalized_email_hash, profile_digest)
    values (referred.id, referrer.id, referee.id,
        sha256(convert_to(lower(btrim(account.email)), 'UTF8')), profile_hash)
    on conflict (referral_id) do nothing;
    select * into saved from public.gate2_referral_profile_verifications
        where referral_id = referred.id;
    if saved.referrer_id is distinct from referrer.id
        or saved.referee_id is distinct from referee.id
    then raise check_violation; end if;
    select count(*) into verified_count
    from public.gate2_referral_profile_verifications
    where referrer_id = referrer.id;
    if verified_count >= 5 then
        insert into public.gate2_referral_vestings
            (referrer_id, verified_profile_count, bonus_cents, idempotency_key)
        values (referrer.id, 5, 500, 'gate2-referral-bonus:' || referrer.id)
        on conflict (referrer_id) do nothing;
    end if;
    select * into vested from public.gate2_referral_vestings
        where referrer_id = referrer.id;
    return jsonb_build_object('verifiedCount', verified_count,
        'bonusVested', vested.id is not null,
        'bonusCents', case when vested.id is not null then 500 else 0 end);
end;
$$;
revoke all on function public.verify_gate2_referred_profile()
    from public, anon, authenticated, service_role;
grant execute on function public.verify_gate2_referred_profile() to authenticated;
