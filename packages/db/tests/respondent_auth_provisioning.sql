begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users (id) values
    ('00000000-0000-4000-8000-000000000601'),
    ('00000000-0000-4000-8000-000000000602'),
    ('00000000-0000-4000-8000-000000000603');
insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-4000-8000-000000000605', 'verified@example.test', now()),
    ('00000000-0000-4000-8000-000000000606', 'unverified@example.test', null),
    ('00000000-0000-4000-8000-000000000607', 'researcher@example.test', now());
insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-000000000604', 'Auth fixture organization');
insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
values ('00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000604', 'test-only', now()),
    ('00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000604', 'test-only', now());

select ok(not has_function_privilege('anon', 'public.provision_respondent(uuid,bytea,bytea)', 'EXECUTE'),
    'anonymous role cannot provision respondents');
select ok(not has_function_privilege('authenticated', 'public.provision_respondent(uuid,bytea,bytea)', 'EXECUTE'),
    'authenticated client role cannot provision respondents');
select ok(not has_function_privilege('anon', 'public.provision_email_respondent(uuid)', 'EXECUTE'),
    'anonymous role cannot provision email respondents');
select ok(not has_function_privilege('authenticated', 'public.provision_email_respondent(uuid)', 'EXECUTE'),
    'authenticated client role cannot self-provision or bypass app attestation');

set local role service_role;
select lives_ok($$
    select public.provision_respondent('00000000-0000-4000-8000-000000000601',
        decode('012345', 'hex'), decode(repeat('ab', 32), 'hex'))
$$, 'trusted service can provision a respondent and their protected phone');
select is(
    public.provision_respondent('00000000-0000-4000-8000-000000000601',
        decode('012346', 'hex'), decode(repeat('ab', 32), 'hex')),
    (select id from public.respondents where auth_user_id = '00000000-0000-4000-8000-000000000601'),
    'retry returns the existing respondent id');
select throws_ok($$
    select public.provision_respondent('00000000-0000-4000-8000-000000000602',
        decode('012345', 'hex'), decode(repeat('ab', 32), 'hex'))
$$, '23505', null, 'another respondent cannot use an already-bound phone hash');
select is((select count(*) from public.respondents
    where auth_user_id = '00000000-0000-4000-8000-000000000602'), 0::bigint,
    'duplicate phone leaves no partial identity');
select is((select phone_e164_ciphertext from pii.respondent_pii
    where phone_hash = decode(repeat('ab', 32), 'hex')), decode('012345', 'hex'),
    'retry with a fresh encryption nonce preserves the original ciphertext');
select throws_ok($$
    select public.provision_respondent('00000000-0000-4000-8000-000000000603',
        decode('012345', 'hex'), decode(repeat('cd', 32), 'hex'))
$$, '42501', null, 'researcher identities cannot enter respondent provisioning');

select lives_ok($$
    select public.provision_email_respondent('00000000-0000-4000-8000-000000000605')
$$, 'trusted service can provision the verified email account');
select is(
    public.provision_email_respondent('00000000-0000-4000-8000-000000000605'),
    (select id from public.respondents where auth_user_id = '00000000-0000-4000-8000-000000000605'),
    'return sign-in keeps the same account');
select ok((select age_attested_at is not null from public.respondents
    where auth_user_id = '00000000-0000-4000-8000-000000000605'), 'age attestation was saved');
select is((select count(*) from pii.respondent_pii where respondent_id =
    (select id from public.respondents where auth_user_id = '00000000-0000-4000-8000-000000000605')),
    0::bigint, 'email sign-in adds no legacy phone record');
select throws_ok($$
    select public.provision_email_respondent('00000000-0000-4000-8000-000000000606')
$$, '42501', null, 'unverified email cannot enter respondent provisioning');
select throws_ok($$
    select public.provision_email_respondent('00000000-0000-4000-8000-000000000607')
$$, '42501', null, 'a verified researcher cannot enter respondent provisioning');
select throws_ok($$
    select public.provision_email_respondent('00000000-0000-4000-8000-000000000601')
$$, '42501', null, 'a legacy account without email must first verify an email');
update public.respondents set status = 'paused' where auth_user_id = '00000000-0000-4000-8000-000000000605';
select throws_ok($$
    select public.provision_email_respondent('00000000-0000-4000-8000-000000000605')
$$, '42501', null, 'a paused account cannot sign back in');

reset role;
select * from finish();
rollback;
