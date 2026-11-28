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
insert into public.answers (id, session_id, study_id, guide_question_id,
  kind, sequence, created_at)
values ('a9790000-0000-4000-8000-000000000007',
  'a9790000-0000-4000-8000-000000000003',
  '90600000-0000-4000-8000-000000000001',
  'a9790000-0000-4000-8000-000000000001', 'text', 2,
  (select created_at + interval '1 second' from public.answers where id =
    'a9790000-0000-4000-8000-000000000004'));
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
printf 'Observed same-slot probe lock race passed.\n'
