begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
update auth.users set email_confirmed_at = now()
where id in ('90300000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000002');
create temp table expected_codes (owner_user_id uuid primary key, code text);
insert into expected_codes select auth_user_id, referral_code
from public.respondents where auth_user_id in (
    '90300000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000002');
grant select on expected_codes to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.read_gate2_referral_self() ->> 'code',
    (select code from expected_codes
        where owner_user_id = '90300000-0000-4000-8000-000000000001'),
    'owner reads only their own referral code');
select is(public.read_gate2_referral_self() ->> 'attributed', 'false',
    'new profile is not automatically attributed');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.read_gate2_referral_self() ->> 'code',
    (select code from expected_codes
        where owner_user_id = '90300000-0000-4000-8000-000000000002'),
    'another owner sees their own code only');
select ok(public.register_gate2_referral((select code from expected_codes
    where owner_user_id = '90300000-0000-4000-8000-000000000001')) is not null,
    'confirmed profile can register one referrer');
select is(public.read_gate2_referral_self() ->> 'attributed', 'true',
    'attribution becomes visible to the referred respondent');
select is(public.read_gate2_referral_self() ->> 'profileVerified', 'false',
    'attribution is distinct from verified profile and bonus vesting');
reset role;
select * from finish();
rollback;
