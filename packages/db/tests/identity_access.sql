begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id) values
    ('00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000021'),
    ('00000000-0000-4000-8000-000000000022'),
    ('00000000-0000-4000-8000-000000000023');

insert into public.organizations (id, name) values
    ('00000000-0000-4000-8000-000000000101', 'Organization A'),
    ('00000000-0000-4000-8000-000000000102', 'Organization B');

insert into public.researchers (auth_user_id, organization_id, role, terms_version, terms_accepted_at) values
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000101', 'admin', 'test-v1', now()),
    ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000102', 'member', 'test-v1', now());

insert into public.respondents (id, auth_user_id, age_attested_at) values
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000021', now()),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000022', now());

insert into pii.respondent_pii (respondent_id, phone_e164_ciphertext, phone_hash) values
    ('00000000-0000-4000-8000-000000000201', decode('12', 'hex'), decode(repeat('01', 32), 'hex'));

select throws_ok(
    $$insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
      values ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000102', 'test-v1', now())$$,
    '23505', null, 'A researcher can belong to only one organization'
);
select throws_ok(
    $$insert into pii.respondent_pii (respondent_id, phone_e164_ciphertext, phone_hash)
      values ('00000000-0000-4000-8000-000000000202', decode('34', 'hex'), decode(repeat('01', 32), 'hex'))$$,
    '23505', null, 'The same phone digest cannot be assigned twice'
);
select is(
    (select count(*) from pg_catalog.pg_class
     where oid in ('public.organizations'::regclass, 'public.researchers'::regclass,
        'public.respondents'::regclass, 'pii.respondent_pii'::regclass)
       and relrowsecurity),
    4::bigint, 'Every identity foundation table enables row-level security'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000021","role":"authenticated","aal":"aal1"}';

select results_eq(
    $$select id from public.respondents order by id$$,
    $$values ('00000000-0000-4000-8000-000000000201'::uuid)$$,
    'A respondent sees only their own identity'
);
select is((select count(*) from public.organizations), 0::bigint, 'A respondent cannot browse organizations');
select throws_ok(
    $$select phone_e164_ciphertext from pii.respondent_pii$$,
    '42501', null, 'A respondent cannot read the private table directly'
);
select throws_ok(
    $$update public.respondents set status = 'active'$$,
    '42501', null, 'A respondent cannot set account status from the client'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}';

select is((select count(*) from public.researchers), 0::bigint, 'Researcher identity access requires MFA');
select is((select count(*) from public.organizations), 0::bigint, 'Researcher organization access requires MFA');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal2"}';

select results_eq(
    $$select id from public.organizations order by id$$,
    $$values ('00000000-0000-4000-8000-000000000101'::uuid)$$,
    'An MFA-verified organization admin sees only their own organization'
);
select results_eq(
    $$select auth_user_id from public.researchers order by auth_user_id$$,
    $$values ('00000000-0000-4000-8000-000000000011'::uuid)$$,
    'An MFA-verified researcher sees only their own membership'
);
select is((select count(*) from public.respondents), 0::bigint, 'Organization admins cannot browse respondents');
select throws_ok(
    $$select phone_e164_ciphertext from pii.respondent_pii$$,
    '42501', null, 'Organization admins cannot query private phone data'
);
select throws_ok(
    $$update public.researchers set organization_id = '00000000-0000-4000-8000-000000000102'$$,
    '42501', null, 'Organization admins cannot change tenant membership from the client'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000023","role":"authenticated","aal":"aal2"}';

select is((select count(*) from public.organizations), 0::bigint, 'An authenticated nonmember sees no organizations');
select is((select count(*) from public.respondents), 0::bigint, 'An authenticated nonmember sees no respondent identities');

set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
    $$select id from public.organizations$$,
    '42501', null, 'Anonymous clients have no organization table privilege'
);

set local role service_role;

select is((select count(*) from pii.respondent_pii), 1::bigint, 'The trusted service role can read private identity data');

reset role;
select * from finish();
rollback;
