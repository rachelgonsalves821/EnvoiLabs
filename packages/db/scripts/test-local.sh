#!/usr/bin/env bash
set -euo pipefail

db_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/envoi-db-test-XXXXXXXX")"
trap 'supabase stop --workdir "$test_dir" --no-backup || true; rm -r -- "$test_dir"' EXIT

supabase init --workdir "$test_dir"
cp -R -- "$db_dir/migrations" "$test_dir/supabase/migrations"
cp -R -- "$db_dir/tests" "$test_dir/supabase/tests"
supabase db start --workdir "$test_dir"
supabase test db --workdir "$test_dir"
