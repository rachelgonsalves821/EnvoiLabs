begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table gate4_rules as select jsonb_build_array(
    jsonb_build_object('surface', 'email-start', 'key_kind', 'email',
        'key_digest', repeat('a', 64), 'max_attempts', 2, 'window_seconds', 3600),
    jsonb_build_object('surface', 'email-start', 'key_kind', 'source',
        'key_digest', repeat('b', 64), 'max_attempts', 3, 'window_seconds', 3600)
) as payload;
grant select on gate4_rules to service_role;
set local role service_role;
select throws_ok($$select public.consume_gate4_rate_limit(
    (select payload from gate4_rules))$$, '23514', null,
    'disabled policy refuses calls before writing');
select throws_ok($$select * from internal.gate4_rate_windows$$, '42501', null,
    'service role cannot read private counters');
select throws_ok($$select * from internal.gate4_rate_policies$$, '42501', null,
    'service role cannot read private policies');
reset role;
select is((select count(*) from internal.gate4_rate_windows), 0::bigint,
    'disabled policy wrote no counters');
update internal.gate4_rate_policies set enabled = true,
    max_attempts = case key_kind when 'email' then 2 else 3 end
where surface = 'email-start';
set local role authenticated;
select throws_ok($$select public.consume_gate4_rate_limit('[]'::jsonb)$$,
    '42501', null, 'authenticated clients cannot call quota RPC');
reset role;
set local role anon;
select throws_ok($$select public.consume_gate4_rate_limit('[]'::jsonb)$$,
    '42501', null, 'anonymous clients cannot call quota RPC');
reset role;
set local role service_role;
select throws_ok($$select public.consume_gate4_rate_limit(
    (select jsonb_set(payload, '{0,max_attempts}', '999'::jsonb) from gate4_rules))$$,
    '23514', null, 'caller cannot enlarge approved policy');
select throws_ok($$select public.consume_gate4_rate_limit(
    (select jsonb_set(payload, '{0,key_digest}', '"bad"'::jsonb) from gate4_rules))$$,
    '23514', null, 'invalid digest is rejected');
select throws_ok($$select public.consume_gate4_rate_limit(
    (select jsonb_build_array(payload -> 0, payload -> 0) from gate4_rules))$$,
    '23514', null, 'duplicate identity key is rejected');
select throws_ok($$select public.consume_gate4_rate_limit(
    (select jsonb_set(payload, '{1,surface}', '"audio-upload"'::jsonb) from gate4_rules))$$,
    '23514', null, 'mixed surfaces are rejected');
select is(public.consume_gate4_rate_limit((select payload from gate4_rules)) ->> 'allowed',
    'true', 'first paired request is allowed');
select is(public.consume_gate4_rate_limit((select payload from gate4_rules)) ->> 'allowed',
    'true', 'second paired request is allowed');
select is(public.consume_gate4_rate_limit((select payload from gate4_rules)) ->> 'allowed',
    'false', 'third request is denied by email limit');
select ok((public.consume_gate4_rate_limit((select payload from gate4_rules))
    ->> 'retry_after_seconds')::integer >= 1,
    'denial returns a positive retry interval');
reset role;
select is((select attempts from internal.gate4_rate_windows
    where key_kind = 'source' and key_digest = repeat('b', 64)), 2,
    'denied email request did not partially increment source');
select is((select count(*) from internal.gate4_rate_windows), 2::bigint,
    'invalid requests wrote no counter rows');

create temp table gate4_other_email as select jsonb_set(payload, '{0,key_digest}',
    to_jsonb(repeat('c', 64))) as payload from gate4_rules;
grant select on gate4_other_email to service_role;
set local role service_role;
select is(public.consume_gate4_rate_limit((select payload from gate4_other_email))
    ->> 'allowed', 'true', 'different email can use final shared source slot');
select is(public.consume_gate4_rate_limit((select payload from gate4_other_email))
    ->> 'allowed', 'false', 'shared source limits another email');
reset role;
select is((select attempts from internal.gate4_rate_windows
    where key_kind = 'email' and key_digest = repeat('c', 64)), 1,
    'source denial does not partially increment the other email');

create temp table gate4_other_source as select jsonb_set(payload, '{1,key_digest}',
    to_jsonb(repeat('d', 64))) as payload from gate4_rules;
grant select on gate4_other_source to service_role;
set local role service_role;
select is(public.consume_gate4_rate_limit((select payload from gate4_other_source))
    ->> 'allowed', 'false', 'same email stays limited across source identities');
reset role;
select is((select count(*) from internal.gate4_rate_windows
    where key_digest = repeat('d', 64)), 0::bigint,
    'cross-source denial does not write a source counter');

update internal.gate4_rate_policies set enabled = true where surface = 'audio-upload';
create temp table gate4_audio as select jsonb_build_array(
    jsonb_build_object('surface', 'audio-upload', 'key_kind', 'respondent',
        'key_digest', repeat('e', 64), 'max_attempts', 10, 'window_seconds', 3600),
    jsonb_build_object('surface', 'audio-upload', 'key_kind', 'source',
        'key_digest', repeat('f', 64), 'max_attempts', 30, 'window_seconds', 3600)
) as payload;
grant select on gate4_audio to service_role;
set local role service_role;
select is(public.consume_gate4_rate_limit((select payload from gate4_audio))
    ->> 'allowed', 'true', 'audio surface has independent respondent/source quota');
select is(public.consume_gate4_rate_limit((select jsonb_set(payload, '{0,key_digest}',
    to_jsonb(repeat('1', 64))) from gate4_audio)) ->> 'allowed', 'true',
    'second respondent can use shared audio source');
reset role;
select is((select count(*) from internal.gate4_rate_windows
    where surface = 'audio-upload'), 3::bigint, 'respondents have separate counters');
update internal.gate4_rate_policies set max_attempts = 1, window_seconds = 1
where surface = 'email-start';
create temp table gate4_short_window as select jsonb_build_array(
    jsonb_build_object('surface', 'email-start', 'key_kind', 'email',
        'key_digest', repeat('3', 64), 'max_attempts', 1, 'window_seconds', 1),
    jsonb_build_object('surface', 'email-start', 'key_kind', 'source',
        'key_digest', repeat('4', 64), 'max_attempts', 1, 'window_seconds', 1)
) as payload;
grant select on gate4_short_window to service_role;
set local role service_role;
select is(public.consume_gate4_rate_limit((select payload from gate4_short_window))
    ->> 'allowed', 'true', 'short fixed window allows first request');
select is(public.consume_gate4_rate_limit((select payload from gate4_short_window))
    ->> 'allowed', 'false', 'short fixed window denies exhausted request');
select pg_sleep(1.05);
select is(public.consume_gate4_rate_limit((select payload from gate4_short_window))
    ->> 'allowed', 'true', 'next fixed window admits a new request');
reset role;
select * from finish();
rollback;
