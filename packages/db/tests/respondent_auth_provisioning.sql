begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into auth.users (id) values
    ('00000000-0000-4000-8000-000000000601'),
    ('00000000-0000-4000-8000-000000000602'),
    ('00000000-0000-4000-8000-000000000603');
insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-000000000604', 'Auth fixture organization');
insert into public.researchers (auth_user_id, organization_id, terms_version, terms_accepted_at)
values ('00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000604', 'test-only', now());

select ok(not has_function_privilege('anon', 'public.provision_respondent(uuid,bytea,bytea)', 'EXECUTE'),
    'anonymous role cannot provision respondents');
select ok(not has_function_privilege('authenticated', 'public.provision_respondent(uuid,bytea,bytea)', 'EXECUTE'),
    'authenticated client role cannot provision respondents');

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

reset role;
select * from finish();
rollback;
