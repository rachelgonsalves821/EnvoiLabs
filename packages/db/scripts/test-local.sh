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
cp -R -- "$db_dir/migrations" "$test_dir/supabase/migrations"
cp -R -- "$db_dir/tests" "$test_dir/supabase/tests"
cp -- "$db_dir/seed.sql" "$test_dir/supabase/seed.sql"

config="$test_dir/supabase/config.toml"
template="$test_dir/db-config.toml"
start_log="$test_dir/db-start.log"
cp -- "$config" "$template"

# Distinct workdirs alone do not isolate Docker host port bindings.
first_port=$((22000 + RANDOM % 14000))
for attempt in 1 2 3; do
    db_port=$((first_port + (attempt - 1) * 1000))
    awk -v port="$db_port" '
        /^[[:space:]]*\[/ {
            db_section = $0 ~ /^[[:space:]]*\[db\][[:space:]]*$/
        }
        db_section && /^[[:space:]]*port[[:space:]]*=/ {
            print "port = " port
            replacements++
            next
        }
        { print }
        END { if (replacements != 1) exit 1 }
    ' "$template" > "$config"

    if supabase db start --workdir "$test_dir" > "$start_log" 2>&1; then
        cat -- "$start_log"
        break
    else
        status=$?
    fi
    cat -- "$start_log" >&2
    if (( attempt == 3 )) || ! grep -Eqi ":$db_port(/tcp)?([^0-9]|$).*(address already in use|port is already allocated)" "$start_log"; then
        exit "$status"
    fi
    printf 'Database test port %s is occupied. Trying another port.\n' "$db_port" >&2
    supabase stop --workdir "$test_dir" --no-backup || true
done

supabase test db --workdir "$test_dir"

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
    printf 'Database types are out of date. Run bash packages/db/scripts/test-local.sh --update-types.\n' >&2
    exit 1
fi
