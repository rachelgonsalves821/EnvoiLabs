#!/usr/bin/env bash
set -euo pipefail

test_dir=${1:?Provide the disposable Supabase workdir}
command -v psql >/dev/null || { printf 'psql is required for fictional-payment race checks.\n' >&2; exit 1; }
status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
db_url=''
while IFS='=' read -r key value; do
  if [[ $key == DB_URL ]]; then
    db_url=${value#\"}; db_url=${db_url%\"}; break
  fi
done <<<"$status"
unset status
if [[ ! $db_url =~ ^postgresql://postgres:[^@]+@127\.0\.0\.1:[0-9]+/postgres$ ]]; then
  printf 'Payment race check requires the isolated loopback database URL.\n' >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/envoi-fictional-payment-XXXXXXXX")"
first_pid=''; second_pid=''
cleanup() {
  touch "$work/release-first" "$work/release-second"
  if [[ -n $first_pid ]]; then wait "$first_pid" 2>/dev/null || true; fi
  if [[ -n $second_pid ]]; then wait "$second_pid" 2>/dev/null || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT

cat >"$work/setup.sql" <<'SQL'
insert into public.studies (id, organization_id, title, state,
  target_completes, length_minutes, deadline_at)
select format('a9910000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  '90100000-0000-4000-8000-000000000001', 'Fictional payment race ' || n,
  'awaiting_payment', 10, 10, clock_timestamp() + interval '3 days'
from generate_series(1, 2) as n;
insert into public.brief_versions (study_id, version, brief_json, created_by)
select id, 1, '{}', '90400000-0000-4000-8000-000000000001'
from public.studies where id::text like 'a9910000-0000-4000-8000-%';
insert into public.guide_questions (id, study_id, position, text)
select format('a9920000-0000-4000-8000-%s',
    lpad((n * 10 + position)::text, 12, '0'))::uuid,
  format('a9910000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  position, 'Race question ' || position
from generate_series(1, 2) as n cross join generate_series(1, 5) as position;
set role service_role;
select count(public.freeze_gate2_marketplace_quote(id, 1,
  (select id from public.pricing_configs where version = 101), 101,
  '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":10,"unitPriceCents":200,"amountCents":10000}]',
  10000, 500, '90200000-0000-4000-8000-000000000001'))
from public.studies where id::text like 'a9910000-0000-4000-8000-%';
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/setup.sql" >"$work/setup.out"
if [[ $(tail -n 1 "$work/setup.out") != 2 ]]; then
  printf 'Could not freeze two fictional-payment race quotes.\n' >&2; exit 1
fi

cat >"$work/first.sql" <<SQL
begin;
set local role service_role;
select public.mark_gate2_fictional_quote(id) from public.gate2_quote_snapshots
where study_id = 'a9910000-0000-4000-8000-000000000001';
\! touch '$work/first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-first" ]; do sleep 0.05; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/first.sql" \
  >"$work/first.out" 2>"$work/first.err" & first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/first-holds-lock" ]] && break
  sleep 0.05
done
if [[ ! -f "$work/first-holds-lock" ]] || [[ $(tail -n 1 "$work/first.out") != t ]]; then
  printf 'Fictional marker did not lock the quote first.\n' >&2; exit 1
fi
PGAPPNAME=envoi_real_payment_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role service_role; insert into public.gate2_payment_events
  (quote_id, study_id, provider_checkout_id, provider_event_id, event_kind,
    amount_cents, currency, provider_observed_at)
  select id, study_id, 'cs_test_real_race', 'real-race', 'paid', total_cents,
    'usd', clock_timestamp() from public.gate2_quote_snapshots
  where study_id = 'a9910000-0000-4000-8000-000000000001';" \
  >"$work/second.out" 2>"$work/second.err" & second_pid=$!
observed_wait=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_real_payment_waiter' and state = 'active'
      and wait_event_type = 'Lock' and query like '%gate2_payment_events%'")"
  if [[ $blocked == 1 ]]; then observed_wait=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed_wait != 1 ]]; then
  printf 'Real payment was not observed waiting on fictional marker.\n' >&2; exit 1
fi
touch "$work/release-first"
wait "$first_pid"; first_pid=''
if wait "$second_pid"; then
  printf 'Real payment incorrectly committed after fictional marker.\n' >&2; exit 1
fi
second_pid=''
if ! grep -q 'payment observation origin mismatch' "$work/second.err"; then
  printf 'Real payment failed for an unexpected reason.\n' >&2; exit 1
fi

cat >"$work/second-first.sql" <<SQL
begin;
set local role service_role;
insert into public.gate2_payment_events
  (quote_id, study_id, provider_checkout_id, provider_event_id, event_kind,
    amount_cents, currency, provider_observed_at)
select id, study_id, 'cs_test_real_first', 'real-first', 'checkout_created',
  total_cents, 'usd', clock_timestamp() from public.gate2_quote_snapshots
where study_id = 'a9910000-0000-4000-8000-000000000002';
\! touch '$work/second-first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-second" ]; do sleep 0.05; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/second-first.sql" \
  >"$work/second-first.out" 2>"$work/second-first.err" & first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/second-first-holds-lock" ]] && break
  sleep 0.05
done
if [[ ! -f "$work/second-first-holds-lock" ]]; then
  printf 'Real payment did not lock the quote first.\n' >&2; exit 1
fi
PGAPPNAME=envoi_fictional_marker_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role service_role; select public.mark_gate2_fictional_quote(id)
  from public.gate2_quote_snapshots where study_id =
    'a9910000-0000-4000-8000-000000000002';" \
  >"$work/marker-second.out" 2>"$work/marker-second.err" & second_pid=$!
observed_wait=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_fictional_marker_waiter' and state = 'active'
      and wait_event_type = 'Lock' and query like '%mark_gate2_fictional_quote%'")"
  if [[ $blocked == 1 ]]; then observed_wait=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed_wait != 1 ]]; then
  printf 'Fictional marker was not observed waiting on real payment.\n' >&2; exit 1
fi
touch "$work/release-second"
wait "$first_pid"; wait "$second_pid"
if [[ $(tail -n 1 "$work/marker-second.out") != f ]]; then
  printf 'Fictional marker reclassified a real payment.\n' >&2; exit 1
fi
printf 'Observed both fictional-marker/payment lock orders passed.\n'
