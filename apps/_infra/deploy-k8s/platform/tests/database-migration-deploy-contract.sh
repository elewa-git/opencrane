#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
ORCHESTRATOR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-orchestrator.sh"
FINALIZATION="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"

bash -n "$DEPLOY_SCRIPT"
bash -n "$ORCHESTRATOR"
bash -n "$FINALIZATION"

for removed_path in database-convergence-classifier.sh database-convergence-policy.sh database-migration-recovery.sh database-transition-resolver.sh; do
  if [[ -e "$ROOT_DIR/apps/_infra/deploy-k8s/platform/$removed_path" ]]; then
    echo "obsolete migration hardening module remains: $removed_path" >&2
    exit 1
  fi
done

if rg -n 'allow-unbacked|backup capability|convergence|migrationFence|fence_existing|recover_failed|helm rollback|database-transition' "$DEPLOY_SCRIPT" "$ORCHESTRATOR" "$FINALIZATION"; then
  echo "database deployment still contains a removed migration safeguard" >&2
  exit 1
fi

grep -q 'DATABASE_MIGRATION_ROOT=' "$DEPLOY_SCRIPT"
grep -q 'DATABASE_MIGRATION_ENABLED=true' "$DEPLOY_SCRIPT"
grep -q -- '--from-release-version fresh is only valid when PostgreSQL has not been created.' "$DEPLOY_SCRIPT"
grep -q 'Source release manifest' "$DEPLOY_SCRIPT"
grep -q 'No reviewed database migration exists from schema' "$DEPLOY_SCRIPT"
grep -q 'publish_database_migration_config_map' "$ORCHESTRATOR"
grep -q 'verify_database_pg_cron_server_preflight' "$ORCHESTRATOR"
grep -q 'install_postgres_release true false' "$ORCHESTRATOR"
grep -q 'revoke_temporary_database_superuser_access' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.sqlSha256=$DATABASE_MIGRATION_SQL_SHA256"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.sourceBaselineSha256=$DATABASE_MIGRATION_SOURCE_BASELINE_SHA256"' "$ORCHESTRATOR"

echo "database migration direct-path contract: PASS"
