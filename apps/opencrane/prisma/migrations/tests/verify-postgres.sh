#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MIGRATION_ROOT="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite"
MANIFEST="$MIGRATION_ROOT/manifest.json"
PREREQUISITE_SQL="$MIGRATION_ROOT/migration.sql"
CENTRAL_MIGRATION_SQL="$ROOT/apps/opencrane/prisma/prisma-migrations/20260829000000_central_authorization_authority/migration.sql"
ATTEMPT_FIXTURE_SQL="$ROOT/apps/opencrane/prisma/migrations/tests/attempt-bound-event-migration.sql"

[[ -n "${DATABASE_URL:-}" ]]
[[ -s "$PREREQUISITE_SQL" ]]
[[ -s "$CENTRAL_MIGRATION_SQL" ]]
[[ -s "$ATTEMPT_FIXTURE_SQL" ]]
[[ "$(jq -r '.owner' "$MANIFEST")" == "apps/opencrane" ]]
[[ "$(jq -r '.privilegedExtension' "$MANIFEST")" == "pg_cron" ]]
[[ "$(jq -r '.sqlSha256' "$MANIFEST")" == "$(shasum -a 256 "$PREREQUISITE_SQL" | awk '{print $1}')" ]]
if rg -n 'admitted 0\.9\.0 baseline lineage|exact 0\.9\.0 source shape|protected baseline origin does not match|migration convergence' "$PREREQUISITE_SQL"; then
  echo "migration SQL still contains removed source-state safeguards" >&2
  exit 1
fi

extract_attempt_migration()
{
  awk '
    /^-- Bind durable run events/ { copying = 1 }
    copying && /^CREATE TRIGGER "tool_invocations_authorization_evidence"/ { exit }
    copying { print }
  ' "$CENTRAL_MIGRATION_SQL"
}

extract_attempt_guard()
{
  awk '
    /^DO \$attempt_backfill_guard\$$/ { copying = 1 }
    copying { print }
    copying && /^\$attempt_backfill_guard\$;$/ { exit }
  ' "$CENTRAL_MIGRATION_SQL"
}

if [[ "$(rg -c '^-- Bind durable run events' "$CENTRAL_MIGRATION_SQL")" != "1" ]] \
  || [[ "$(rg -c '^DO \$attempt_backfill_guard\$$' "$CENTRAL_MIGRATION_SQL")" != "1" ]] \
  || [[ "$(rg -c '^CREATE TRIGGER "conversation_run_events_append_only" BEFORE UPDATE OR DELETE' "$CENTRAL_MIGRATION_SQL")" != "1" ]] \
  || [[ "$(rg -c '^CREATE TRIGGER "child_run_completion_deliveries_authority" BEFORE INSERT OR UPDATE OR DELETE' "$CENTRAL_MIGRATION_SQL")" != "1" ]]; then
  echo "central migration attempt-authority extraction markers drifted" >&2
  exit 1
fi

set +e
ambiguity_output="$({
  sed -n '1,/^-- APPLY THE EXACT ATTEMPT MIGRATION HERE$/p' "$ATTEMPT_FIXTURE_SQL"
  extract_attempt_guard
} | psql "$DATABASE_URL" -X --set=ON_ERROR_STOP=1 --set=AMBIGUOUS=true 2>&1)"
ambiguity_status=$?
set -e
if [[ "$ambiguity_status" -eq 0 ]] || ! grep -Fq 'OC_RUN_EVENT_ATTEMPT_BACKFILL_RESET_REQUIRED' <<<"$ambiguity_output"; then
  echo "$ambiguity_output" >&2
  echo "ambiguous attemptless RunEvent history did not fail with its reset-required guard" >&2
  exit 1
fi

{
  sed -n '1,/^-- APPLY THE EXACT ATTEMPT MIGRATION HERE$/p' "$ATTEMPT_FIXTURE_SQL"
  extract_attempt_migration
  sed -n '/^-- VERIFY THE MIGRATED ATTEMPT AUTHORITY HERE$/,$p' "$ATTEMPT_FIXTURE_SQL"
} | psql "$DATABASE_URL" -X --set=ON_ERROR_STOP=1 --set=AMBIGUOUS=false

echo "0.9.0-to-0.10.0 prerequisite PostgreSQL migration contract: PASS"
echo "0.9.2-to-0.10.0 attempt-bound persistence migration: PASS"
