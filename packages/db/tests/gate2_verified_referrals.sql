begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

update auth.users set email_confirmed_at = clock_timestamp()
where id in (select auth_user_id from public.respondents
    where id in (select format('90500000-0000-4000-8000-%s',
        lpad(n::text, 12, '0'))::uuid from generate_series(1, 7) as n));
select ok(not has_table_privilege('authenticated',
    'public.gate2_referral_profile_verifications', 'SELECT')
    and not has_table_privilege('authenticated',
        'public.gate2_referral_vestings', 'SELECT'),
    'private verification and bonus ledger cannot be read by clients');
select ok(not has_function_privilege('anon',
    'public.register_gate2_referral(text)', 'EXECUTE')
    and not has_function_privilege('anon',
        'public.verify_gate2_referred_profile()', 'EXECUTE'),
    'anonymous users cannot attribute or verify referrals');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.register_gate2_referral('fixture-1')$$,
    '23514', null, 'self-referral is rejected');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$select public.register_gate2_referral('fixture-1')$$,
    '23514', null, 'unconfirmed email cannot enter referral attribution');
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(public.register_gate2_referral('fixture-1') is not null,
    'the first distinct referee is attributed to the link owner');
select is(public.register_gate2_referral('fixture-1')::text,
    public.register_gate2_referral('fixture-1')::text,
    'an exact attribution retry keeps the same referral');
select throws_ok($$select public.register_gate2_referral('fixture-3')$$,
    '23514', null, 'a second referrer cannot claim an already attributed profile');
select throws_ok($$select public.verify_gate2_referred_profile()$$,
    '23514', null, 'an incomplete profile does not count');
reset role;
insert into public.profile_attributes (respondent_id, key, value_json, source)
select format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    item.key, item.value_json, 'signup'
from generate_series(2, 7) as n
cross join (values
    ('age_range', '"25-34"'::jsonb), ('gender', '"undisclosed"'::jsonb),
    ('student_year', '"not_student"'::jsonb),
    ('online_shopping_frequency', '"weekly"'::jsonb),
    ('region_zip', '"10001"'::jsonb),
    ('interests', '["food","shopping"]'::jsonb)) as item(key, value_json)
on conflict (respondent_id, key) do nothing;
set local role authenticated;
do $$
begin
    for n in 2..5 loop
        perform set_config('request.jwt.claims', jsonb_build_object(
            'sub', format('90300000-0000-4000-8000-%s', lpad(n::text, 12, '0')),
            'role', 'authenticated')::text, true);
        perform public.register_gate2_referral('fixture-1');
        perform public.verify_gate2_referred_profile();
    end loop;
end;
$$;
reset role;
select is((select count(*) from public.gate2_referral_profile_verifications
    where referrer_id = '90500000-0000-4000-8000-000000000001'),
    4::bigint, 'four distinct verified profiles do not vest the bonus');
select is((select count(*) from public.gate2_referral_vestings
    where referrer_id = '90500000-0000-4000-8000-000000000001'),
    0::bigint, 'no $5 vesting before the fifth verified profile');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000006","role":"authenticated"}';
select ok(public.register_gate2_referral('fixture-1') is not null,
    'fifth distinct friend has a stable attribution');
select is(public.verify_gate2_referred_profile() ->> 'bonusCents',
    '500', 'fifth verified profile vests exactly $5');
select is(public.verify_gate2_referred_profile() ->> 'verifiedCount',
    '5', 'verification retry keeps the five-profile threshold');
reset role;
select is((select count(*) from public.gate2_referral_vestings
    where referrer_id = '90500000-0000-4000-8000-000000000001'),
    1::bigint, 'repeated verification creates only one vesting record');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000007","role":"authenticated"}';
select ok(public.register_gate2_referral('fixture-1') is not null,
    'a sixth distinct verified friend can still be attributed');
select is(public.verify_gate2_referred_profile() ->> 'verifiedCount',
    '6', 'sixth profile does not reset the existing threshold');
reset role;
select is((select count(*) from public.gate2_referral_vestings
    where referrer_id = '90500000-0000-4000-8000-000000000001'),
    1::bigint, 'sixth profile does not create a second $5 bonus');
insert into public.referrals (referrer_id, referee_id, state)
values ('90500000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000008', 'profile_pending');
select throws_ok($$insert into public.gate2_referral_profile_verifications
    (referral_id, referrer_id, referee_id, normalized_email_hash, profile_digest)
    select referral.id, referral.referrer_id, referral.referee_id,
        (select normalized_email_hash from public.gate2_referral_profile_verifications
            where referee_id = '90500000-0000-4000-8000-000000000002'),
        sha256(convert_to('duplicate synthetic profile', 'UTF8'))
    from public.referrals as referral
    where referral.referee_id = '90500000-0000-4000-8000-000000000008'$$,
    '23505', null, 'the same normalized email identity cannot count twice');
select is((select idempotency_key from public.gate2_referral_vestings
    where referrer_id = '90500000-0000-4000-8000-000000000001'),
    'gate2-referral-bonus:90500000-0000-4000-8000-000000000001',
    'the future payout key is stable and has no provider call');
select throws_ok($$update public.gate2_referral_vestings
    set bonus_cents = 1000$$, '23514', 'Gate 2 ledger rows are immutable',
    'vested amount cannot be changed');
select throws_ok($$update public.referrals
    set referrer_id = '90500000-0000-4000-8000-000000000003'
    where referee_id = '90500000-0000-4000-8000-000000000002'$$,
    '23514', null, 'a verified referee cannot be moved to another referrer');
select * from finish();
rollback;
