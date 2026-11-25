begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
update auth.users set email_confirmed_at = now()
where id in ('90300000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000002');

select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
    and has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT'),
    'subscription endpoint and keys are not directly readable or writable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.register_gate2_push_subscription(
    'https://push.example.test/subscription/1',
    repeat('A', 86), repeat('B', 22))$$, '23514', 'check_violation',
    'registration requires distinct current push purpose consent');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', true, 'synthetic-push-only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(public.register_gate2_push_subscription(
    'https://push.example.test/subscription/1',
    repeat('A', 86), repeat('B', 22)),
    'consented owner registers a private endpoint');
select ok(public.register_gate2_push_subscription(
    'https://push.example.test/subscription/1',
    repeat('C', 86), repeat('D', 22)),
    'exact endpoint re-registration updates keys without another row');
reset role;
select is((select count(*)::integer from public.push_subscriptions
    where endpoint = 'https://push.example.test/subscription/1'), 1,
    'registration is idempotent by endpoint');
select is((select keys_json ->> 'p256dh' from public.push_subscriptions
    where endpoint = 'https://push.example.test/subscription/1'), repeat('C', 86),
    'current private key material replaces stale material');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.register_gate2_push_subscription(
    'https://push.example.test/subscription/1',
    repeat('E', 86), repeat('F', 22))$$, '23514', 'check_violation',
    'another respondent without consent cannot claim the endpoint');
select ok(not public.remove_gate2_push_subscription(
    'https://push.example.test/subscription/1'),
    'another respondent cannot remove the owner endpoint');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001',
    'push_notifications', false, 'synthetic-push-revoked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.register_gate2_push_subscription(
    'https://push.example.test/subscription/2',
    repeat('A', 86), repeat('B', 22))$$, '23514', 'check_violation',
    'revoked consent blocks a new endpoint');
select ok(public.remove_gate2_push_subscription(
    'https://push.example.test/subscription/1'),
    'owner can remove endpoint after consent revocation');
reset role;
select is((select count(*)::integer from public.push_subscriptions
    where endpoint = 'https://push.example.test/subscription/1'), 0,
    'remove destroys private transport material');
select * from finish();
rollback;
