-- A respondent may see only their own referral code and attribution state.
-- The existing immutable five-profile ledger remains the authority for vesting.
create function public.read_gate2_referral_self()
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('code', respondent.referral_code,
        'attributed', referral.id is not null,
        'profileVerified', verification.id is not null)
    from public.respondents as respondent
    join auth.users as account on account.id = respondent.auth_user_id
    left join public.referrals as referral on referral.referee_id = respondent.id
    left join public.gate2_referral_profile_verifications as verification
        on verification.referee_id = respondent.id
    where respondent.auth_user_id = auth.uid() and respondent.status = 'active'
        and account.email_confirmed_at is not null;
$$;
revoke all on function public.read_gate2_referral_self()
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_referral_self() to authenticated;
