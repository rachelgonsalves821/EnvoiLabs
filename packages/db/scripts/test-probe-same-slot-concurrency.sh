#!/usr/bin/env bash
set -euo pipefail

test_dir=${1:?Provide the disposable Supabase workdir}
command -v psql >/dev/null || { printf 'psql is required for the two-connection probe check.\n' >&2; exit 1; }
status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
db_url=''
while IFS='=' read -r key value; do
  if [[ $key == DB_URL ]]; then
    db_url=${value#\"}
    db_url=${db_url%\"}
    break
  fi
done <<<"$status"
unset status
if [[ ! $db_url =~ ^postgresql://postgres:[^@]+@127\.0\.0\.1:[0-9]+/postgres$ ]]; then
  printf 'Probe race check requires the isolated loopback database URL.\n' >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/envoi-probe-race-XXXXXXXX")"
first_pid=''
second_pid=''
cleanup() {
  touch "$work/release-first"
  if [[ -n $first_pid ]]; then wait "$first_pid" 2>/dev/null || true; fi
  if [[ -n $second_pid ]]; then wait "$second_pid" 2>/dev/null || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT

cat >"$work/setup.sql" <<'SQL'
alter table public.transcripts add column if not exists redacted_source_version
  uuid not null default gen_random_uuid();
update public.studies set state = 'fielding'
  where id = '90600000-0000-4000-8000-000000000001';
insert into public.guide_questions (id, study_id, position, text, max_probes)
values ('a9790000-0000-4000-8000-000000000001',
  '90600000-0000-4000-8000-000000000001', 1, 'Why?', 2);
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('a9790000-0000-4000-8000-000000000002',
  '90600000-0000-4000-8000-000000000001',
  '90500000-0000-4000-8000-000000000001', 'accepted', 100,
  clock_timestamp() + interval '1 hour');
insert into public.sessions (id, invite_id, study_id, state)
values ('a9790000-0000-4000-8000-000000000003',
  'a9790000-0000-4000-8000-000000000002',
  '90600000-0000-4000-8000-000000000001', 'in_progress');
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
insert into public.consents (respondent_id, study_id, purpose, granted, text_version)
select '90500000-0000-4000-8000-000000000001',
  '90600000-0000-4000-8000-000000000001', purpose, true, 'probe-race-fixture'
from unnest(array['retention', 'researcher_access', 'ai_followup']) as x(purpose);
insert into public.answers (id, session_id, study_id, guide_question_id, kind, sequence)
values ('a9790000-0000-4000-8000-000000000004',
  'a9790000-0000-4000-8000-000000000003',
  '90600000-0000-4000-8000-000000000001',
  'a9790000-0000-4000-8000-000000000001', 'text', 1);
insert into public.transcripts (id, answer_id, study_id, redacted_text,
  provider, model, latency_ms, cost_micros)
values ('a9790000-0000-4000-8000-000000000005',
  'a9790000-0000-4000-8000-000000000004',
  '90600000-0000-4000-8000-000000000001',
  'The closer option.', 'typed', 'none', 0, 0);
insert into pii.transcript_raw (transcript_id, raw_text)
values ('a9790000-0000-4000-8000-000000000005', 'The closer option.');
insert into internal.gate1_answer_jobs (answer_id, source_hash, completed_at,
  result_status, publication_policy_digest, publication_qualification_digest)
values ('a9790000-0000-4000-8000-000000000004',
  decode(repeat('c', 64), 'hex'), clock_timestamp(), 'published',
  repeat('a', 64), repeat('b', 64));
set role service_role;
select case when public.record_gate3_probe_upload_clock(
  'a9790000-0000-4000-8000-000000000004',
  '90300000-0000-4000-8000-000000000001',
  'a9790000-0000-4000-8000-000000000006', 1000,
  'text_save_response') = 'recorded' then 'ready' else 'not_ready' end;
reset role;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/setup.sql" >"$work/setup.out"
if [[ $(tail -n 1 "$work/setup.out") != ready ]]; then
  printf 'Could not prepare the qualified probe race fixture.\n' >&2
  exit 1
fi

cat >"$work/first.sql" <<SQL
begin;
select id from public.sessions where id =
  'a9790000-0000-4000-8000-000000000003' for update;
\! touch '$work/first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-first" ]; do sleep 0.05; done'
set local role authenticated;
set local request.jwt.claims = '{"sub":"90300000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.record_gate1_text_answer(
  'a9790000-0000-4000-8000-000000000003',
  'a9790000-0000-4000-8000-000000000001',
  'a9790000-0000-4000-8000-000000000007',
  'The newer option.',
  'a9790000-0000-4000-8000-000000000004');
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/first.sql" \
  >"$work/first.out" 2>"$work/first.err" &
first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/first-holds-lock" ]] && break
  sleep 0.05
done
if [[ ! -f "$work/first-holds-lock" ]]; then
  printf 'Replacement writer never held the session lock.\n' >&2
  exit 1
fi

PGAPPNAME=envoi_gate2_probe_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role service_role; select coalesce(public.begin_gate3_probe_turn_with_clock(
    'a9790000-0000-4000-8000-000000000004',
    '90300000-0000-4000-8000-000000000001')::text, 'null');" \
  >"$work/second.out" 2>"$work/second.err" &
second_pid=$!
observed_wait=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_gate2_probe_waiter' and state = 'active'
      and wait_event_type = 'Lock'
      and query like '%begin_gate3_probe_turn_with_clock%'")"
  if [[ $blocked == 1 ]]; then observed_wait=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed_wait != 1 ]]; then
  printf 'Probe begin was not observed waiting on the session lock.\n' >&2
  exit 1
fi
touch "$work/release-first"
wait "$first_pid"
wait "$second_pid"
if [[ $(tail -n 1 "$work/second.out") != null ]]; then
  printf 'The old probe turn opened after the replacement committed.\n' >&2
  exit 1
fi
turns="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select count(*) from internal.gate3_probe_turns where answer_id =
    'a9790000-0000-4000-8000-000000000004'")"
if [[ $turns != 0 ]]; then
  printf 'A stale turn was persisted after the replacement committed.\n' >&2
  exit 1
fi

# Inverse order: begin B first, then an authenticated replacement C waits.
# B's committed turn must be removed with the replaced answer before any
# provider-ready read or model dispatch can use it.
cat >"$work/prepare-inverse.sql" <<'SQL'
update public.transcripts set redacted_text = 'The newer option.'
where answer_id = 'a9790000-0000-4000-8000-000000000007';
update internal.gate1_answer_jobs set source_hash = decode(repeat('d', 64), 'hex'),
  completed_at = clock_timestamp(),
  result_status = 'published', publication_policy_digest = repeat('a', 64),
  publication_qualification_digest = repeat('b', 64)
where answer_id = 'a9790000-0000-4000-8000-000000000007';
set role service_role;
select public.record_gate3_probe_upload_clock(
  'a9790000-0000-4000-8000-000000000007',
  '90300000-0000-4000-8000-000000000001',
  'a9790000-0000-4000-8000-000000000008', 2000,
  'text_save_response');
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/prepare-inverse.sql" \
  >"$work/prepare-inverse.out"
if [[ $(tail -n 1 "$work/prepare-inverse.out") != recorded ]]; then
  printf 'Could not prepare the inverse qualified answer.\n' >&2
  exit 1
fi

cat >"$work/inverse-first.sql" <<SQL
begin;
set local role service_role;
select coalesce(public.begin_gate3_probe_turn_with_clock(
  'a9790000-0000-4000-8000-000000000007',
  '90300000-0000-4000-8000-000000000001')::text, 'null');
\! touch '$work/inverse-first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-inverse-first" ]; do sleep 0.05; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/inverse-first.sql" \
  >"$work/inverse-first.out" 2>"$work/inverse-first.err" &
first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/inverse-first-holds-lock" ]] && break
  sleep 0.05
done
if [[ ! -f "$work/inverse-first-holds-lock" ]] ||
  [[ $(tail -n 1 "$work/inverse-first.out") == null ]]; then
  printf 'Inverse probe begin did not hold an eligible turn.\n' >&2
  exit 1
fi

PGAPPNAME=envoi_gate2_answer_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role authenticated; set request.jwt.claims =
    '{\"sub\":\"90300000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}';
    select public.record_gate1_text_answer(
      'a9790000-0000-4000-8000-000000000003',
      'a9790000-0000-4000-8000-000000000001',
      'a9790000-0000-4000-8000-000000000009',
      'The final option.',
      'a9790000-0000-4000-8000-000000000007');" \
  >"$work/inverse-second.out" 2>"$work/inverse-second.err" &
second_pid=$!
observed_wait=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_gate2_answer_waiter' and state = 'active'
      and wait_event_type = 'Lock'
      and query like '%record_gate1_text_answer%'")"
  if [[ $blocked == 1 ]]; then observed_wait=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed_wait != 1 ]]; then
  printf 'Authenticated replacement was not observed waiting on the session lock.\n' >&2
  exit 1
fi
touch "$work/release-inverse-first"
wait "$first_pid"
wait "$second_pid"
turns="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select count(*) from internal.gate3_probe_turns where answer_id =
    'a9790000-0000-4000-8000-000000000007'")"
if [[ $turns != 0 ]]; then
  printf 'A replaced answer retained a provider-eligible turn.\n' >&2
  exit 1
fi
printf 'Observed both same-slot probe lock orders through authenticated answer replacement.\n'
