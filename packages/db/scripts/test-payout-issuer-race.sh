#!/usr/bin/env bash
set -euo pipefail

test_dir=${1:?Provide the disposable Supabase workdir}
command -v psql >/dev/null || { printf 'psql is required for payout issuer races.\n' >&2; exit 1; }
status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
db_url=''
while IFS='=' read -r key value; do
  if [[ $key == DB_URL ]]; then db_url=${value#\"}; db_url=${db_url%\"}; break; fi
done <<<"$status"
unset status
if [[ ! $db_url =~ ^postgresql://postgres:[^@]+@127\.0\.0\.1:[0-9]+/postgres$ ]]; then
  printf 'Payout issuer race requires an isolated loopback database.\n' >&2; exit 1
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/envoi-payout-issuer-XXXXXXXX")"
first_pid=''; second_pid=''
cleanup() {
  touch "$work/release-first" "$work/release-second"
  if [[ -n $first_pid ]]; then wait "$first_pid" 2>/dev/null || true; fi
  if [[ -n $second_pid ]]; then wait "$second_pid" 2>/dev/null || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT

cat >"$work/setup.sql" <<'SQL'
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
select format('a9930000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  '90600000-0000-4000-8000-000000000001',
  format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'accepted', 1000,
  clock_timestamp() + interval '1 day'
from generate_series(1, 2) as n;
insert into public.sessions (id, invite_id, study_id, state)
select format('a9940000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('a9930000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  '90600000-0000-4000-8000-000000000001', 'quality_hold'
from generate_series(1, 2) as n;
insert into public.payouts (id, session_id, respondent_id,
  amount_cents, idempotency_key)
select format('a9950000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('a9940000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  1000,
  'payout:a9940000-0000-4000-8000-' || lpad(n::text, 12, '0')
from generate_series(1, 2) as n;
insert into internal.gate2_sandbox_visa_intents (payout_id, session_id,
  respondent_id, amount_cents, recipient_name, recipient_email, country,
  product_id, verification_receipt, catalog_receipt)
select format('a9950000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('a9940000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  1000,
  'Fictional Race Person', 'race@example.test', 'US', 'sandbox_visa',
  'synthetic:race_route_1', 'synthetic:race_catalog_1'
from generate_series(1, 2) as n;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/setup.sql" >"$work/setup.out"

cat >"$work/first.sql" <<SQL
begin;
set local role gate2_fictional_issuer;
select public.claim_gate2_payout_issuer(
  'a9950000-0000-4000-8000-000000000001', 'fictional');
\! touch '$work/first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-first" ]; do sleep 0.05; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/first.sql" \
  >"$work/first.out" 2>"$work/first.err" & first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/first-holds-lock" ]] && break; sleep 0.05
done
if [[ ! -f "$work/first-holds-lock" ]] || [[ $(tail -n 1 "$work/first.out") != t ]]; then
  printf 'Fictional issuer did not claim the first payout.\n' >&2; exit 1
fi
PGAPPNAME=envoi_real_issuer_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role service_role; select public.claim_gate2_payout_issuer(
    'a9950000-0000-4000-8000-000000000001', 'test_provider');" \
  >"$work/second.out" 2>"$work/second.err" & second_pid=$!
observed=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_real_issuer_waiter' and state = 'active' and
      wait_event_type = 'Lock' and query like '%claim_gate2_payout_issuer%'")"
  if [[ $blocked == 1 ]]; then observed=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed != 1 ]]; then
  printf 'Real issuer was not observed waiting on fictional claim.\n' >&2; exit 1
fi
touch "$work/release-first"
if ! wait "$first_pid"; then cat "$work/first.err" >&2; exit 1; fi
if ! wait "$second_pid"; then cat "$work/second.err" >&2; exit 1; fi
first_pid=''; second_pid=''
if [[ $(tail -n 1 "$work/second.out") != f ]]; then
  printf 'Real issuer took the ambiguous fictional payout.\n' >&2; exit 1
fi

cat >"$work/second-first.sql" <<SQL
begin;
set local role service_role;
select public.claim_gate2_payout_issuer(
  'a9950000-0000-4000-8000-000000000002', 'test_provider');
\! touch '$work/second-first-holds-lock'
\! sh -c 'while [ ! -f "$work/release-second" ]; do sleep 0.05; done'
commit;
SQL
psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -f "$work/second-first.sql" \
  >"$work/second-first.out" 2>"$work/second-first.err" & first_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$work/second-first-holds-lock" ]] && break; sleep 0.05
done
if [[ ! -f "$work/second-first-holds-lock" ]] ||
  [[ $(tail -n 1 "$work/second-first.out") != t ]]; then
  printf 'TEST issuer did not claim the second payout.\n' >&2; exit 1
fi
PGAPPNAME=envoi_fictional_issuer_waiter psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
  "set role gate2_fictional_issuer; select public.claim_gate2_payout_issuer(
    'a9950000-0000-4000-8000-000000000002', 'fictional');" \
  >"$work/marker-second.out" 2>"$work/marker-second.err" & second_pid=$!
observed=0
for _ in $(seq 1 100); do
  blocked="$(psql "$db_url" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name =
      'envoi_fictional_issuer_waiter' and state = 'active' and
      wait_event_type = 'Lock' and query like '%claim_gate2_payout_issuer%'")"
  if [[ $blocked == 1 ]]; then observed=1; break; fi
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $observed != 1 ]]; then
  printf 'Fictional issuer was not observed waiting on TEST claim.\n' >&2; exit 1
fi
touch "$work/release-second"
if ! wait "$first_pid"; then cat "$work/second-first.err" >&2; exit 1; fi
if ! wait "$second_pid"; then cat "$work/marker-second.err" >&2; exit 1; fi
if [[ $(tail -n 1 "$work/marker-second.out") != f ]]; then
  printf 'Fictional issuer relabelled an ambiguous TEST payout.\n' >&2; exit 1
fi
printf 'Observed both payout issuer lock orders passed.\n'
