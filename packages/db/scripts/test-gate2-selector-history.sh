#!/usr/bin/env bash
set -euo pipefail

# Rehearse an isolated database whose Gate 1 selector was already applied
# before the older, stacked Gate 2 migrations. Never target a linked project.
db_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/envoi-selector-history-XXXXXXXX")"
cleanup() {
  supabase stop --workdir "$test_dir" --no-backup >/dev/null 2>&1 || true
  rm -r -- "$test_dir"
}
trap cleanup EXIT

supabase init --workdir "$test_dir" >/dev/null
mkdir -p -- "$test_dir/supabase/migrations" "$test_dir/supabase/tests"
shopt -s nullglob
baseline=("$db_dir"/migrations/20261120*.sql
  "$db_dir"/migrations/20261121*.sql
  "$db_dir"/migrations/20261123*.sql)
if (( ${#baseline[@]} != 19 )); then
  printf 'Expected 19 standalone Gate 1 baseline migrations; found %s. Review the history manifest.\n' "${#baseline[@]}" >&2
  exit 1
fi
cp -- "${baseline[@]}" "$test_dir/supabase/migrations/"
cp -- "$db_dir/migrations/20261124013900_gate1_expired_audio_selection.sql" \
  "$test_dir/supabase/migrations/"
cp -- "$db_dir/seed.sql" "$test_dir/supabase/seed.sql"
supabase db start --workdir "$test_dir" >/dev/null

project_id="$(basename -- "$test_dir" | tr '[:upper:]' '[:lower:]')"
db_container="supabase_db_$project_id"
selector_count="$(docker exec "$db_container" psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -Atqc "select count(*) from supabase_migrations.schema_migrations
    where version = '20261124013900'")"
if [[ "$selector_count" != 1 ]]; then
  printf '%s\n' 'The standalone selector was not recorded in migration history.' >&2
  exit 1
fi

# Add every remaining migration without resetting the already-applied
# selector. --include-all is required for versions older than 139.
cp -- "$db_dir"/migrations/*.sql "$test_dir/supabase/migrations/"
supabase migration up --local --include-all --workdir "$test_dir" >/dev/null
combined_count="$(docker exec "$db_container" psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -Atqc "select count(*) from supabase_migrations.schema_migrations
    where version in ('20261124013800', '20261124013900')")"
if [[ "$combined_count" != 2 ]]; then
  printf '%s\n' 'The older Gate 2 migration did not join the selector history.' >&2
  exit 1
fi

cp -- "$db_dir/tests/gate2_audio_selector_history.sql" "$test_dir/supabase/tests/"
supabase test db --workdir "$test_dir"
printf '%s\n' 'The isolated selector-first and older-Gate-2 migration history passed.'
