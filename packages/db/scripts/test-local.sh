#!/usr/bin/env bash
set -euo pipefail

if (( $# > 0 )) && [[ $# != 1 || $1 != '--update-types' ]]; then
    printf 'Usage: %s [--update-types]\n' "$0" >&2
    exit 2
fi

db_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/envoi-db-test-XXXXXXXX")"
trap 'supabase stop --workdir "$test_dir" --no-backup || true; rm -r -- "$test_dir"' EXIT

supabase init --workdir "$test_dir"
if [[ -n ${ENVOI_DB_TEST_PORT:-} ]]; then
    if [[ ! $ENVOI_DB_TEST_PORT =~ ^[0-9]+$ ]] ||
        (( ENVOI_DB_TEST_PORT < 1024 || ENVOI_DB_TEST_PORT > 65535 )); then
        printf 'ENVOI_DB_TEST_PORT must be a valid nonprivileged port.\n' >&2
        exit 2
    fi
    sed -i "s/^port = 54322$/port = $ENVOI_DB_TEST_PORT/" "$test_dir/supabase/config.toml"
fi
cp -R -- "$db_dir/migrations" "$test_dir/supabase/migrations"
cp -R -- "$db_dir/tests" "$test_dir/supabase/tests"
cp -- "$db_dir/seed.sql" "$test_dir/supabase/seed.sql"
supabase db start --workdir "$test_dir"
supabase test db --workdir "$test_dir"
bash "$db_dir/scripts/test-fictional-payment-race.sh" "$test_dir"
bash "$db_dir/scripts/test-payout-issuer-race.sh" "$test_dir"

types_file="$db_dir/src/database.generated.ts"
generated="$test_dir/database.generated.ts"
supabase gen types --lang typescript --local --schema public --workdir "$test_dir" > "$generated"
if [[ ! -s "$generated" ]]; then
    printf 'Supabase generated an empty database type file.\n' >&2
    exit 1
fi

if [[ ${1:-} == '--update-types' ]]; then
    mkdir -p -- "$(dirname -- "$types_file")"
    cp -- "$generated" "$types_file"
elif ! cmp -s -- "$generated" "$types_file"; then
    diff -u -- "$types_file" "$generated" || true
    printf 'Database types are out of date. Run bash packages/db/scripts/test-local.sh --update-types.\n' >&2
    exit 1
fi
