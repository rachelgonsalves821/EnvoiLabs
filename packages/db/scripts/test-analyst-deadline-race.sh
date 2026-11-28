#!/usr/bin/env bash
set -euo pipefail

test_dir=${1:?Provide the disposable Supabase workdir}
command -v psql >/dev/null || { printf 'psql is required.\n' >&2; exit 1; }
status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
db_url=''
while IFS='=' read -r key value; do
  if [[ $key == DB_URL ]]; then db_url=${value#\"}; db_url=${db_url%\"}; break; fi
done <<<"$status"
unset status
if [[ ! $db_url =~ ^postgresql://postgres:[^@]+@127\.0\.0\.1:[0-9]+/postgres$ ]]; then
  printf 'Analyst deadline race requires an isolated loopback database.\n' >&2
  exit 1
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/envoi-analyst-deadline-XXXXXXXX")"
holder_pid=''; waiter_pid=''
cleanup() {
  touch "$work/release"
  if [[ -n $holder_pid ]]; then wait "$holder_pid" 2>/dev/null || true; fi
  if [[ -n $waiter_pid ]]; then wait "$waiter_pid" 2>/dev/null || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT

request_id='a9990000-0000-4000-8000-000000000199'
study_id='a9900000-0000-4000-8000-000000000199'
quote_id='a9980000-0000-4000-8000-000000000199'
researcher_id='a9970000-0000-4000-8000-000000000199'
reviewer_id='a9960000-0000-4000-8000-000000000199'
digest="$(printf '%064d' 0)"

# This private request has no FK to public study data. It isolates the exact
# final-lock predicate called by the proposal writer.
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c "
  insert into internal.gate3_analysis_requests (request_id, study_id,
    quote_id, researcher_auth_user_id, reviewer_receipt_id,
    binding_digest, started_at, deadline_at)
  values ('$request_id', '$study_id', '$quote_id', '$researcher_id',
    '$reviewer_id', '$digest', clock_timestamp(),
    clock_timestamp() + interval '1500 milliseconds');" >"$work/setup.out"

cat >"$work/hold.sql" <<SQL
begin;
select 1 from internal.gate3_analysis_requests
  where request_id = '$request_id' for update;
\! touch '$work/holding'
\! sh -c 'while [ ! -f "$work/release" ]; do sleep 0.03; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/hold.sql" \
  >"$work/hold.out" 2>"$work/hold.err" & holder_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/holding" ]] && break
  sleep 0.02
done
if [[ ! -f "$work/holding" ]]; then
  printf 'Analyst request lock holder did not start.\n' >&2
  exit 1
fi

PGAPPNAME=envoi_analyst_deadline_waiter psql "$db_url" -X -qAt \
  -v ON_ERROR_STOP=1 -c "select internal.gate3_analysis_request_is_live(
    '$request_id', '$study_id', '$quote_id', '$researcher_id',
    '$reviewer_id', '$digest');" >"$work/wait.out" 2>"$work/wait.err" &
waiter_pid=$!
observed=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c "
    select count(*) from pg_stat_activity
    where application_name = 'envoi_analyst_deadline_waiter'
      and state = 'active' and wait_event_type = 'Lock';")"
  if [[ $blocked == 1 ]]; then observed=1; break; fi
  if ! kill -0 "$waiter_pid" 2>/dev/null; then break; fi
  sleep 0.02
done
if [[ $observed != 1 ]]; then
  printf 'Analyst save was not observed waiting for its request lock.\n' >&2
  cat "$work/wait.err" >&2
  exit 1
fi
before_deadline="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c "
  select clock_timestamp() < deadline_at
  from internal.gate3_analysis_requests where request_id = '$request_id';")"
if [[ $before_deadline != t ]]; then
  printf 'Analyst waiter reached the lock only after deadline.\n' >&2
  exit 1
fi

psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c "
  select pg_sleep(greatest(0, extract(epoch from deadline_at -
    clock_timestamp())) + 0.08)
  from internal.gate3_analysis_requests where request_id = '$request_id';" \
  >"$work/sleep.out"
if ! kill -0 "$waiter_pid" 2>/dev/null; then
  printf 'Analyst waiter exited before the held row was released.\n' >&2
  cat "$work/wait.err" >&2
  exit 1
fi
touch "$work/release"
if ! wait "$holder_pid"; then cat "$work/hold.err" >&2; exit 1; fi
if ! wait "$waiter_pid"; then cat "$work/wait.err" >&2; exit 1; fi
holder_pid=''; waiter_pid=''
if [[ $(tail -n 1 "$work/wait.out") != f ]]; then
  printf 'A late analyst request passed after lock release.\n' >&2
  exit 1
fi
printf 'Observed analyst request lock wait crossing deadline; late save denied.\n'
