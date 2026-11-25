#!/usr/bin/env bash
set -euo pipefail
umask 077

db_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd -- "$db_dir/../.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/envoi-auth-XXXXXXXX")"
project_id="$(basename -- "$test_dir" | tr '[:upper:]' '[:lower:]')"

cleanup() {
  supabase stop --workdir "$test_dir" --no-backup >/dev/null 2>&1 || true
  rm -r -- "$test_dir"
}
trap cleanup EXIT

mkdir -- "$test_dir/supabase"
{
  printf 'project_id = "%s"\n\n' "$project_id"
  if [[ "${ENVOI_AUTH_TEST_LINK:-}" == 'pkce' ]]; then
    sed -e '/^\[auth\.email\.template\.magic_link\]/,+2d' \
        -e 's/^enable_confirmations = false$/enable_confirmations = true/' "$db_dir/scripts/auth-test-config.toml"
  else
    cat -- "$db_dir/scripts/auth-test-config.toml"
  fi
} >"$test_dir/supabase/config.toml"
cp -R -- "$db_dir/migrations" "$test_dir/supabase/migrations"
cp -R -- "$db_dir/templates" "$test_dir/supabase/templates"
# Kong runs as a separate UID and serves this public email template to local Auth.
chmod 755 "$test_dir/supabase/templates"
chmod 644 "$test_dir/supabase/templates/magic-link.html"

# Startup and status can print credentials. Keep their output out of the CI log.
if ! (umask 022; supabase start --workdir "$test_dir") >/dev/null 2>&1; then
  printf '%s\n' 'The disposable Supabase stack failed to start and apply migrations.' >&2
  docker ps --all --filter "name=$project_id" --format '{{.Names}}: {{.Status}}' >&2 || true
  exit 1
fi

local_status="$(supabase status --workdir "$test_dir" --output env 2>/dev/null)"
status_value() {
  local wanted key value
  for wanted in "$@"; do
    while IFS='=' read -r key value; do
      if [[ "$key" != "$wanted" ]]; then continue; fi
      value="${value#\"}"
      value="${value%\"}"
      if [[ -n "$value" ]]; then
        printf '%s' "$value"
        return
      fi
    done <<<"$local_status"
  done
  printf 'Missing local Supabase status field: %s\n' "$*" >&2
  return 1
}

SUPABASE_URL="$(status_value API_URL)"
SUPABASE_PUBLISHABLE_KEY="$(status_value PUBLISHABLE_KEY ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(status_value SERVICE_ROLE_KEY SECRET_KEY)"
unset local_status
if [[ "$SUPABASE_URL" != "http://127.0.0.1:54321" ]]; then
  printf '%s\n' 'The test refuses to use a non-fixture Supabase endpoint.' >&2
  exit 1
fi

# Allow only the synthetic redactor on this disposable database.
docker exec -i "supabase_db_$project_id" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into internal.gate1_redaction_policies (policy_digest, qualification_digest)
values (repeat('a', 64), repeat('b', 64));
SQL

export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY
export ENVOI_APP_ORIGIN="http://127.0.0.1:3100"
export ENVOI_TEST_LOCAL_SUPABASE=1
export ENVOI_GATE1_TEST_LAUNCH=1
export ENVOI_GATE2_SCREENING_SHEET_ENABLED=true
export ENVOI_GATE2_EARNINGS_ENABLED=true
export ENVOI_MARKETPLACE_FEASIBILITY_ENABLED=true

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  printf '::add-mask::%s\n' "$SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
fi

cd -- "$repo_dir"
pnpm exec playwright test --project=desktop-chromium --retries 0 --workers 1 auth-local.spec.ts gate1-slice.spec.ts gate2-screening.spec.ts gate2-marketplace.spec.ts
if [[ "${ENVOI_AUTH_TEST_LINK:-custom}" == 'custom' ]]; then
  node --test apps/web/server/respondent/gate1-worker.integration.mjs apps/web/server/respondent/gate1-worker-formats.integration.mjs
fi
