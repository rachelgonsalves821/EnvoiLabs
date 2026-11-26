begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.referrals (referrer_id, referee_id, state)
select '90500000-0000-4000-8000-000000000001',
    format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
    'profile_pending' from generate_series(2, 6) as n;
insert into public.gate2_referral_profile_verifications
    (referral_id, referrer_id, referee_id,
    normalized_email_hash, profile_digest)
select referral.id, referral.referrer_id, referral.referee_id,
    sha256(convert_to('referral-test-' || referral.referee_id, 'UTF8')),
    sha256(convert_to('profile-test-' || referral.referee_id, 'UTF8'))
from public.referrals as referral
where referral.referrer_id = '90500000-0000-4000-8000-000000000001'
    and referral.referee_id <> '90500000-0000-4000-8000-000000000006';
insert into public.gate2_referral_vestings
    (id, referrer_id, verified_profile_count, bonus_cents, idempotency_key)
values ('a9f50000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 5, 500,
    'gate2-referral-bonus:90500000-0000-4000-8000-000000000001');
insert into internal.gate2_sandbox_visa_routes
    (respondent_id, recipient_name, recipient_email,
    country, verification_receipt)
values ('90500000-0000-4000-8000-000000000001', 'Synthetic Referrer',
    'referrer@example.test', 'US', 'synthetic:referral_route_1');
insert into internal.gate2_sandbox_visa_products
    (country, product_id, minimum_cents, maximum_cents, catalog_receipt)
values ('US', 'sandbox_visa', 1000, 50000, 'synthetic:referral_catalog_1');
select ok(not has_function_privilege('authenticated',
    'public.reserve_gate2_sandbox_visa_referral_bonus(uuid,integer)', 'EXECUTE'),
    'respondents cannot reserve their own referral payout');
set local role service_role;
select throws_ok($$select public.reserve_gate2_sandbox_visa_referral_bonus(
    'a9f50000-0000-4000-8000-000000000001', 200000)$$,
    '23514', null, 'a forged vesting with only four verified profiles is denied');
reset role;
insert into public.gate2_referral_profile_verifications
    (referral_id, referrer_id, referee_id,
    normalized_email_hash, profile_digest)
select referral.id, referral.referrer_id, referral.referee_id,
    sha256(convert_to('referral-test-' || referral.referee_id, 'UTF8')),
    sha256(convert_to('profile-test-' || referral.referee_id, 'UTF8'))
from public.referrals as referral
where referral.referee_id = '90500000-0000-4000-8000-000000000006';
set local role service_role;
select is(public.reserve_gate2_sandbox_visa_referral_bonus(
    'a9f50000-0000-4000-8000-000000000001', 200000) ->> 'status',
    'below_minimum', 'a $10 Visa minimum keeps the $5 bonus vested');
reset role;
select is((select count(*) from public.payouts
    where bonus_ref = 'a9f50000-0000-4000-8000-000000000001'),
    0::bigint, 'below-minimum bonus has no payout or provider intent');
alter table internal.gate2_sandbox_visa_products
    disable trigger immutable_gate2_sandbox_visa_products;
update internal.gate2_sandbox_visa_products set minimum_cents = 500
where country = 'US';
alter table internal.gate2_sandbox_visa_products
    enable trigger immutable_gate2_sandbox_visa_products;
update public.respondents set ytd_payout_cents = 199500,
    ytd_payout_year = extract(year from now() at time zone 'UTC')::integer
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.reserve_gate2_sandbox_visa_referral_bonus(
    'a9f50000-0000-4000-8000-000000000001', 200000)$$,
    '23514', null, 'five-dollar bonus is reserved against the annual cap');
reset role;
update public.respondents set ytd_payout_cents = 0
where id = '90500000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.reserve_gate2_sandbox_visa_referral_bonus(
    'a9f50000-0000-4000-8000-000000000001', 200000) ->> 'status',
    'reserved', 'five verified profiles reserve one frozen TEST Visa bonus');
select is(public.reserve_gate2_sandbox_visa_referral_bonus(
    'a9f50000-0000-4000-8000-000000000001', 200000) ->> 'payoutId',
    (select id::text from public.payouts
        where bonus_ref = 'a9f50000-0000-4000-8000-000000000001'),
    'retry returns the original referral payout identity');
reset role;
select is((select count(*) from public.payouts
    where bonus_ref = 'a9f50000-0000-4000-8000-000000000001'),
    1::bigint, 'one payout is reserved for the vesting');
select is((select amount_cents from public.payouts
    where bonus_ref = 'a9f50000-0000-4000-8000-000000000001'),
    500, 'referral payout is exactly five dollars');
select is((select referral_vesting_id::text
    from internal.gate2_sandbox_visa_intents
    where respondent_id = '90500000-0000-4000-8000-000000000001'),
    'a9f50000-0000-4000-8000-000000000001',
    'provider recipient/SKU intent binds the vesting');
set local role service_role;
select is(public.read_gate2_sandbox_visa_webhook_claim(
    (select id from public.payouts
        where bonus_ref = 'a9f50000-0000-4000-8000-000000000001'))
        ->> 'amountCents', '500',
    'signed sandbox observation can reconcile the frozen bonus amount');
reset role;
select * from finish();
rollback;
