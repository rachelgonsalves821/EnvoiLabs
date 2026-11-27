#!/usr/bin/env bash
set -euo pipefail

test_dir=${1:?Provide the disposable Supabase workdir}
command -v psql >/dev/null || { printf 'psql is required for the two-connection budget test.\n' >&2; exit 1; }
local_status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
db_url=''
while IFS='=' read -r key value; do
  if [[ $key == DB_URL ]]; then
    db_url=${value#\"}
    db_url=${db_url%\"}
    break
  fi
done <<<"$local_status"
unset local_status
if [[ ! $db_url =~ ^postgresql://postgres:[^@]+@127\.0\.0\.1:[0-9]+/postgres$ ]]; then
  printf 'The budget test requires the isolated loopback database URL.\n' >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/envoi-budget-XXXXXXXX")"
first_pid=''
second_pid=''
cleanup() {
  touch "$work/release-first"
  if [[ -n $first_pid ]]; then wait "$first_pid" 2>/dev/null || true; fi
  if [[ -n $second_pid ]]; then wait "$second_pid" 2>/dev/null || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT
study='90600000-0000-4000-8000-000000000001'
researcher='90200000-0000-4000-8000-000000000001'
# Do not let the two transactions straddle an hourly window boundary.
remaining="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select extract(epoch from date_trunc('hour', now()) + interval '1 hour' - now())::integer")"
if (( remaining < 10 )); then sleep 12; fi
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select public.consume_gate2_test_provider_budget('$study', '$researcher', 1) ->> 'status' from generate_series(1,9)" \
  >"$work/seed.out"
if [[ $(grep -c '^allow$' "$work/seed.out") != 9 ]]; then
  printf 'Could not prepare nine reserved provider units.\n' >&2
  exit 1
fi

cat >"$work/first.sql" <<SQL
begin;
set role service_role;
select public.consume_gate2_test_provider_budget('$study', '$researcher', 3) ->> 'status';
\! touch '$work/first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-first" ]; do sleep 0.05; done'
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
  wait "$first_pid" || true
  printf 'First connection did not reach its held row lock.\n' >&2
  exit 1
fi

PGAPPNAME=envoi_gate2_budget_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "begin; set role service_role; select public.consume_gate2_test_provider_budget('$study', '$researcher', 3) ->> 'status'; commit;" \
  >"$work/second.out" 2>"$work/second.err" &
second_pid=$!
observed_wait=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name = 'envoi_gate2_budget_waiter' and state = 'active' and wait_event_type = 'Lock' and query like '%consume_gate2_test_provider_budget%'")"
  if [[ $blocked == 1 ]]; then observed_wait=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed_wait != 1 ]]; then
  printf 'Second connection was not observed waiting on the budget row lock.\n' >&2
  exit 1
fi
touch "$work/release-first"
wait "$first_pid"
wait "$second_pid"
if ! grep -qx 'allow' "$work/first.out" || ! grep -qx 'limited' "$work/second.out"; then
  printf 'Two connections crossed the twelve-request reservation cap.\n' >&2
  exit 1
fi
reserved="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select reserved_requests from internal.gate2_test_provider_budgets where study_id = '$study' and auth_user_id = '$researcher'")"
if [[ $reserved != 12 ]]; then
  printf 'Concurrent budget row was not capped at twelve.\n' >&2
  exit 1
fi
printf 'Observed lock-wait provider budget boundary passed.\n'
