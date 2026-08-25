#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MIGRATION_ROOT="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.9.3"
MANIFEST="$MIGRATION_ROOT/manifest.json"
SQL="$MIGRATION_ROOT/migration.sql"

[[ -s "$SQL" ]]
[[ "$(jq -r '.owner' "$MANIFEST")" == "apps/opencrane" ]]
[[ "$(jq -r '.privilegedExtension' "$MANIFEST")" == "pg_cron" ]]
[[ "$(jq -r '.sqlSha256' "$MANIFEST")" == "$(shasum -a 256 "$SQL" | awk '{print $1}')" ]]
if rg -n 'admitted 0\.9\.0 baseline lineage|exact 0\.9\.0 source shape|protected baseline origin does not match|migration convergence' "$SQL"; then
  echo "migration SQL still contains removed source-state safeguards" >&2
  exit 1
fi

echo "0.9.0-to-0.9.3 direct PostgreSQL migration contract: PASS"
