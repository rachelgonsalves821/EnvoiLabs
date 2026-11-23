begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.case_id(value integer) returns uuid language sql immutable as $$
    select format('a9600000-0000-4000-8000-%s', lpad(value::text, 12, '0'))::uuid;
$$;
create temporary table claims (label text primary key, payload jsonb);
grant select, insert on claims to service_role;
update public.studies set state = 'fielding' where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text)
select pg_temp.case_id(n), '90600000-0000-4000-8000-000000000001', n, 'Question ' || n
from generate_series(1, 3) as step(n);
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values (pg_temp.case_id(10), '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'accepted', 160, now() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values (pg_temp.case_id(11), pg_temp.case_id(10), '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into pii.audio_objects (id, storage_path, mime, bytes, sha256)
values (pg_temp.case_id(12), 'test/private.webm', 'audio/webm', 42, decode(repeat('ab', 32), 'hex'));
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence, audio_object_id, duration_ms)
select pg_temp.case_id(n + 20), pg_temp.case_id(11), '90600000-0000-4000-8000-000000000001', pg_temp.case_id(n),
    case when n = 3 then 'voice' else 'text' end, n, case when n = 3 then pg_temp.case_id(12) end,
    case when n = 3 then 1000 end
from generate_series(1, 3) as step(n);
insert into public.transcripts (id, answer_id, study_id, provider, model, latency_ms, cost_micros)
select pg_temp.case_id(n + 30), pg_temp.case_id(n + 20), '90600000-0000-4000-8000-000000000001', 'typed', 'none', 0, 0
from generate_series(1, 2) as step(n);
insert into pii.transcript_raw (transcript_id, raw_text)
select pg_temp.case_id(n + 30), 'Private fixture ' || n from generate_series(1, 2) as step(n);
insert into internal.gate1_answer_jobs (answer_id)
select pg_temp.case_id(n + 20) from generate_series(1, 3) as step(n);

select ok(not has_function_privilege('authenticated', 'public.claim_gate1_answer_job(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_gate1_answer_job(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_gate1_answer_job(uuid,uuid,text,text,text,integer,bigint,text,boolean,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'internal.complete_gate1_answer_job(uuid,uuid,text,text,text,integer,bigint,text,boolean)', 'EXECUTE')
    and not has_table_privilege('service_role', 'internal.gate1_redaction_policies', 'INSERT')
    and not has_function_privilege('service_role', 'internal.gate1_processing_input(uuid)', 'EXECUTE'),
    'only scoped service RPCs expose work and completion');
set local role service_role;
select is(public.claim_gate1_answer_job(), null::jsonb, 'missing retention consent stays unclaimed');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001', purpose, true, 'fixture-v1'
from unnest(array['retention','researcher_access']) as consent(purpose);

set local role service_role;
insert into claims values ('first', public.claim_gate1_answer_job());
select is((select payload ->> 'rawText' from claims where label = 'first'), 'Private fixture 1', 'service claim delivers only this typed input');
select is(public.claim_gate1_answer_job(pg_temp.case_id(21)), null::jsonb, 'active lease cannot be claimed twice');
select ok(public.validate_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'first')), 'verify a current lease before processing');
select ok(public.retry_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'first'), 60), 'release a lease with a retry delay');
select is(public.claim_gate1_answer_job(pg_temp.case_id(21)), null::jsonb, 'retry is hidden before the delay');
reset role;
update internal.gate1_answer_jobs set available_at = now() where answer_id = pg_temp.case_id(21);
update public.transcripts set redacted_text = 'Accidental pending projection' where answer_id = pg_temp.case_id(21);
set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from research.transcripts), 0::bigint, 'pending or failed jobs stay hidden even if a row already has text');
reset role;

set local role service_role;
insert into claims values ('second', public.claim_gate1_answer_job(pg_temp.case_id(21)));
select is((select payload ->> 'attempts' from claims where label = 'second'), '2', 'retry receives a new attempt');
select is(public.complete_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'first')) ->> 'status', 'stale', 'old lease cannot complete a retried job');
select is(public.complete_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'second'), supplied_redacted_text => 'Unqualified output', supplied_redaction_passed => true) ->> 'status', 'private', 'boolean without policy stays private');
select is(public.complete_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'second')) ->> 'status', 'alreadyCompleted', 'exact completion replay dedupes');
select is((select redacted_text from public.transcripts where answer_id = pg_temp.case_id(21)), null::text, 'private completion clears unqualified output');
select ok(public.requeue_gate1_answer_job(pg_temp.case_id(21)), 'worker can deliberately requeue private completion');
insert into claims values ('unapproved-policy', public.claim_gate1_answer_job(pg_temp.case_id(21)));
select is(public.complete_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'unapproved-policy'), supplied_redacted_text => 'Unapproved output', supplied_redaction_passed => true, supplied_policy_digest => repeat('c', 64)) ->> 'status', 'private', 'unapproved policy stays private');
select ok(public.requeue_gate1_answer_job(pg_temp.case_id(21)), 'unapproved policy completion can be requeued');
reset role;
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
set local role service_role;
insert into claims values ('qualified', public.claim_gate1_answer_job(pg_temp.case_id(21)));
select is(public.complete_gate1_answer_job(pg_temp.case_id(21), (select (payload ->> 'leaseId')::uuid from claims where label = 'qualified'), supplied_redacted_text => 'Qualified synthetic answer', supplied_redaction_passed => true, supplied_policy_digest => repeat('a', 64)) ->> 'status', 'published', 'approved policy publishes under current consent');
select ok(not public.requeue_gate1_answer_job(pg_temp.case_id(21)), 'private requeue cannot republish a completed publication');
reset role;
select is((select publication_policy_digest from internal.gate1_answer_jobs where answer_id = pg_temp.case_id(21)), repeat('a', 64), 'completion records the active policy digest');
update internal.gate1_redaction_policies set revoked_at = now() where policy_digest = repeat('a', 64);
set local role authenticated;
select is((select count(*) from research.transcripts), 0::bigint, 'revoked policy immediately hides its projection');
reset role;
update internal.gate1_redaction_policies set revoked_at = null where policy_digest = repeat('a', 64);

set local role authenticated;
select is((select redacted_text from research.transcripts), 'Qualified synthetic answer', 'same-tenant MFA researcher sees only the qualified projection');
reset role;
update public.sessions set state = 'paid' where id = pg_temp.case_id(11);
set local role authenticated;
select is((select redacted_text from research.transcripts), 'Qualified synthetic answer', 'settling the interview retains its qualified projection');
reset role;
update public.sessions set state = 'in_progress' where id = pg_temp.case_id(11);
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', false, 'fixture-v2');
set local role authenticated;
select is((select count(*) from research.transcripts), 0::bigint, 'later withdrawal immediately hides publication');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', true, 'fixture-v3');
set local role authenticated;
select is((select count(*) from research.transcripts), 0::bigint, 'regrant does not revive a stale published projection');
reset role;

set local role service_role;
insert into claims values ('replacement', public.claim_gate1_answer_job(pg_temp.case_id(22)));
select is(public.claim_gate1_answer_job(pg_temp.case_id(23)), null::jsonb, 'voice requires recording and vendor consent');
reset role;
delete from public.answers where id = pg_temp.case_id(22);
insert into public.consents (respondent_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001', purpose, true, 'fixture-v1'
from unnest(array['recording','transcription_vendor']) as consent(purpose);
set local role service_role;
select is(public.complete_gate1_answer_job(pg_temp.case_id(22), (select (payload ->> 'leaseId')::uuid from claims where label = 'replacement'), supplied_redacted_text => 'Must not appear', supplied_redaction_passed => true) ->> 'status', 'stale', 'a removed or replaced answer cannot publish');
insert into claims values ('voice', public.claim_gate1_answer_job(pg_temp.case_id(23)));
select is((select payload #>> '{audio,sha256}' from claims where label = 'voice'), repeat('ab', 32), 'voice claim returns the canonical SHA-256 only to the service');
select is((select payload #>> '{audio,durationMs}' from claims where label = 'voice'), '1000', 'voice claim returns the stored duration estimate');
select ok((select not (payload ? 'rawText') from claims where label = 'voice'), 'voice claim has no transcript text');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'transcription_vendor', false, 'fixture-v2');
set local role service_role;
select ok(not public.validate_gate1_answer_job(pg_temp.case_id(23), (select (payload ->> 'leaseId')::uuid from claims where label = 'voice')), 'current vendor withdrawal blocks the immediate pre-processing check');
select is(public.complete_gate1_answer_job(pg_temp.case_id(23), (select (payload ->> 'leaseId')::uuid from claims where label = 'voice'), 'Private voice result', 'fixture', 'fixture', 10, 0, 'Synthetic projection', true) ->> 'status', 'stale', 'mid-processing withdrawal blocks private output and publication');
select is((select count(id) from public.transcripts where answer_id = pg_temp.case_id(23)), 0::bigint, 'stale voice result wrote no transcript');
reset role;
update internal.gate1_answer_jobs set lease_expires_at = now() where answer_id = pg_temp.case_id(23);
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'transcription_vendor', true, 'fixture-v3');
set local role service_role;
insert into claims values ('voice-reclaim', public.claim_gate1_answer_job(pg_temp.case_id(23)));
select ok((select payload ->> 'leaseId' from claims where label = 'voice-reclaim')
    <> (select payload ->> 'leaseId' from claims where label = 'voice'), 'an expired lease yields a new token');
reset role;
insert into public.consents (respondent_id, purpose, granted, text_version)
values ('90500000-0000-4000-8000-000000000001', 'researcher_access', false, 'fixture-v4');
set local role service_role;
select is(public.complete_gate1_answer_job(pg_temp.case_id(23), (select (payload ->> 'leaseId')::uuid from claims where label = 'voice-reclaim'), 'Private retained voice', 'fixture', 'fixture-model', 10, 12, 'Qualified fixture', true) ->> 'status', 'private', 'withdrawn researcher access preserves allowed private processing only');
select is((select model from public.transcripts where answer_id = pg_temp.case_id(23)), 'fixture-model', 'private voice metadata is durable');
select is((select raw.raw_text from public.transcripts as t join pii.transcript_raw as raw on raw.transcript_id = t.id
    where t.answer_id = pg_temp.case_id(23)), 'Private retained voice', 'voice transcript is restricted to private storage');
reset role;

select * from finish();
rollback;
