#!/usr/bin/env bash
set -euo pipefail

MIGRATOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOSITORY_ROOT="$(cd "$MIGRATOR_ROOT/../.." && pwd)"
DOCKERFILE="$REPOSITORY_ROOT/apps/opencrane/deploy/Dockerfile"
ENTRYPOINT="$MIGRATOR_ROOT/run-migrations.sh"
MIGRATION_LEDGER="$REPOSITORY_ROOT/apps/opencrane/prisma/prisma-migrations"

bash -n "$ENTRYPOINT"
test -s "$DOCKERFILE"
test -d "$MIGRATION_LEDGER"
grep -Fq "FROM build AS migration" "$DOCKERFILE"
grep -Fq "COPY apps/opencrane-prisma-migrator/run-migrations.sh /app/run-migrations.sh" "$DOCKERFILE"
grep -Fq 'CMD ["/app/run-migrations.sh"]' "$DOCKERFILE"
find "$MIGRATION_LEDGER" -mindepth 2 -maxdepth 2 -name migration.sql -print -quit | grep -q .

echo "OpenCrane Prisma migrator build contract: PASS"
