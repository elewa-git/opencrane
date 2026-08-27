#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
ORCHESTRATOR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-orchestrator.sh"
FINALIZATION="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"

bash -n "$DEPLOY_SCRIPT"
bash -n "$ORCHESTRATOR"
bash -n "$FINALIZATION"

for removed_path in database-convergence-classifier.sh database-convergence-policy.sh database-migration-recovery.sh database-transition-resolver.sh database-pg-cron-preflight.sh database-superuser-access.sh; do
  if [[ -e "$ROOT_DIR/apps/_infra/deploy-k8s/platform/$removed_path" ]]; then
    echo "obsolete migration hardening module remains: $removed_path" >&2
    exit 1
  fi
done

if rg -n 'allow-unbacked|backup capability|convergence|migrationFence|fence_existing|recover_failed|helm rollback|database-transition' "$DEPLOY_SCRIPT" "$ORCHESTRATOR" "$FINALIZATION"; then
  echo "database deployment still contains a removed migration safeguard" >&2
  exit 1
fi

grep -q 'DATABASE_MIGRATION_ENABLED=true' "$DEPLOY_SCRIPT"
grep -q -- '--from-release-version fresh is only valid when PostgreSQL has not been created.' "$DEPLOY_SCRIPT"
grep -q 'Source release manifest' "$DEPLOY_SCRIPT"
! grep -q "No Prisma migration exists from schema" "$DEPLOY_SCRIPT"
grep -q "is not the candidate's exact predecessor" "$DEPLOY_SCRIPT"
grep -q 'prepare_database_release_transition' "$DEPLOY_SCRIPT"
grep -q 'finish_database_release_transition' "$DEPLOY_SCRIPT"
grep -q -- '--set-string "migration.image=$PRISMA_MIGRATOR_IMAGE"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.sourceVersion=$FROM_RELEASE_VERSION"' "$ORCHESTRATOR"

prepare_line="$(grep -n '^prepare_database_release_transition$' "$DEPLOY_SCRIPT" | cut -d: -f1)"
publish_line="$(grep -n '^publish_postgres_database_connection .*POSTGRES_APP_SECRET' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1)"
finish_line="$(grep -n '^finish_database_release_transition$' "$DEPLOY_SCRIPT" | cut -d: -f1)"
[[ "$prepare_line" -lt "$publish_line" && "$publish_line" -lt "$finish_line" ]]

if rg -n 'migration.sqlSha256|migration.sourceBaselineSha256|migration.configMap|DATABASE_MIGRATION_SQL|DATABASE_PRIVILEGED_EXTENSION|database-migration-silo-id|publish_database_migration_config_map' "$DEPLOY_SCRIPT" "$ORCHESTRATOR"; then
  echo "database deployment still contains the retired direct-SQL migration path" >&2
  exit 1
fi

echo "database migration direct-path contract: PASS"
