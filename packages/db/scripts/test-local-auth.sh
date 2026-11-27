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
insert into internal.gate2_screening_model_policies (provider_model,
    prompt_version, prompt_digest, consent_text_version,
    consent_text_digest, approved_at)
values ('synthetic-model', 'screening-v1', repeat('c', 64),
    'synthetic-ai-screening-v1', repeat('d', 64), clock_timestamp());
-- Disposable Auth fixture only. This helper is never a repository migration.
create function public.test_gate2_screening_purpose_receipt(supplied_consent_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
    if not exists (select 1 from public.consents as consent
        join public.respondents as respondent on respondent.id = consent.respondent_id
        join auth.users as account on account.id = respondent.auth_user_id
        where consent.id = supplied_consent_id and consent.purpose = 'ai_screening'
            and consent.granted and consent.study_id is not null
            and consent.text_version = 'synthetic-ai-screening-v1'
            and account.email like '%@example.test')
    then raise check_violation; end if;
    insert into internal.gate2_screening_consent_receipts (consent_id, text_digest)
    values (supplied_consent_id, repeat('d', 64)) on conflict do nothing;
    return true;
end;
$$;
revoke all on function public.test_gate2_screening_purpose_receipt(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.test_gate2_screening_purpose_receipt(uuid)
    to service_role;
-- Disposable browser fixture: construct one private typed answer input so
-- the normal lease/completion RPC can produce a real synthetic receipt.
create function public.test_gate1_transcript_input(
    supplied_answer_id uuid, supplied_raw_text text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare source_id uuid;
begin
    if nullif(btrim(supplied_raw_text), '') is null or not exists (
        select 1 from public.answers as answer
        join public.sessions as interview on interview.id = answer.session_id
        join public.invites as offer on offer.id = interview.invite_id
        join public.respondents as respondent on respondent.id = offer.respondent_id
        join auth.users as account on account.id = respondent.auth_user_id
        where answer.id = supplied_answer_id and answer.kind = 'text'
            and account.email like '%@example.test'
    ) then return false; end if;
    select id into source_id from public.transcripts
        where answer_id = supplied_answer_id;
    if source_id is null then return false; end if;
    insert into pii.transcript_raw (transcript_id, raw_text)
    values (source_id, supplied_raw_text);
    insert into internal.gate1_answer_jobs (answer_id)
    values (supplied_answer_id);
    return true;
end;
$$;
revoke all on function public.test_gate1_transcript_input(uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.test_gate1_transcript_input(uuid, text)
    to service_role;
notify pgrst, 'reload schema';
SQL

# Local-only payout denomination fixture. The helper exists only in this
# disposable stack and accepts approved synthetic @example.test accounts.
docker exec -i "supabase_db_$project_id" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$db_dir/scripts/gate2-visa-e2e-fixture.sql" >/dev/null
docker exec -i "supabase_db_$project_id" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$db_dir/scripts/gate2-audio-history-e2e-fixture.sql" >/dev/null

export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY
export ENVOI_APP_ORIGIN="http://127.0.0.1:3100"
export ENVOI_TEST_LOCAL_SUPABASE=1
export ENVOI_GATE1_TEST_LAUNCH=1
export ENVOI_GATE2_SCREENING_SHEET_ENABLED=true
export ENVOI_GATE2_SCREENING_VOICE_ENABLED=true
export ENVOI_GATE2_EARNINGS_ENABLED=true
export ENVOI_MARKETPLACE_FEASIBILITY_ENABLED=true

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  printf '::add-mask::%s\n' "$SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
fi

cd -- "$repo_dir"
pnpm exec playwright test --project=desktop-chromium --retries 0 --workers 1 auth-local.spec.ts gate1-slice.spec.ts gate2-screening.spec.ts gate2-screening-voice.spec.ts gate2-marketplace.spec.ts gate2-audio-selector.spec.ts
if [[ "${ENVOI_AUTH_TEST_LINK:-custom}" == 'custom' ]]; then
  node --test apps/web/server/respondent/gate1-worker.integration.mjs apps/web/server/respondent/gate1-worker-formats.integration.mjs
fi
