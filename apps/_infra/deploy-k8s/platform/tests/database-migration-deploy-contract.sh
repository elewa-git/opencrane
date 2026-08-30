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
grep -q '^CLUSTER_TENANT=""$' "$DEPLOY_SCRIPT"
grep -q -- '--cluster-tenant) CLUSTER_TENANT="$2"' "$DEPLOY_SCRIPT"
grep -q '(( ${#CLUSTER_TENANT} > 63 ))' "$DEPLOY_SCRIPT"
grep -q -- '--cluster-tenant must identify the target silo with a DNS label.' "$DEPLOY_SCRIPT"
grep -q -- '--from-release-version fresh is only valid when PostgreSQL has not been created.' "$DEPLOY_SCRIPT"
grep -q 'Source release manifest' "$DEPLOY_SCRIPT"
! grep -q "No Prisma migration exists from schema" "$DEPLOY_SCRIPT"
grep -q "is not the candidate's exact predecessor" "$DEPLOY_SCRIPT"
grep -q '^prepare_database_release_transition || exit \$?$' "$DEPLOY_SCRIPT"
grep -q '^finish_database_release_transition || exit \$?$' "$DEPLOY_SCRIPT"
grep -q 'install_postgres_release false false false' "$ORCHESTRATOR"
grep -q 'install_postgres_release false false true' "$ORCHESTRATOR"
grep -q 'wait_for_postgres_database_applied "database/${POSTGRES_RELEASE}-opencrane"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.image=$PRISMA_MIGRATOR_IMAGE"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.sourceVersion=$FROM_RELEASE_VERSION"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.siloId=$CLUSTER_TENANT"' "$ORCHESTRATOR"
grep -q -- '--set-string "migration.oidcIssuer=$OIDC_ISSUER_URL"' "$ORCHESTRATOR"
grep -q -- '0.9.2-to-0.10.0 database prerequisite requires --oidc-issuer-url' "$DEPLOY_SCRIPT"

prepare_line="$(grep -n '^prepare_database_release_transition || exit \$?$' "$DEPLOY_SCRIPT" | cut -d: -f1)"
publish_line="$(grep -n '^publish_postgres_database_connection .*POSTGRES_APP_SECRET' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1)"
finish_line="$(grep -n '^finish_database_release_transition || exit \$?$' "$DEPLOY_SCRIPT" | cut -d: -f1)"
[[ "$prepare_line" -lt "$publish_line" && "$publish_line" -lt "$finish_line" ]]

if rg -n 'migration.sqlSha256|migration.sourceBaselineSha256|migration.configMap|DATABASE_MIGRATION_SQL|DATABASE_PRIVILEGED_EXTENSION|database-migration-silo-id|publish_database_migration_config_map' "$DEPLOY_SCRIPT" "$ORCHESTRATOR"; then
  echo "database deployment still contains the retired direct-SQL migration path" >&2
  exit 1
fi

CLUSTER_TENANT="testv4"
POSTGRES_RELEASE="opencrane-testv4-postgres"
POSTGRES_CHART_DIR="$ROOT_DIR/apps/postgres/helm"
NAMESPACE="opencrane-testv4"
POSTGRES_OPERAND_IMAGE="ghcr.io/elewa-git/opencrane-postgres:test"
POSTGRES_OWNER="opencrane"
POSTGRES_CREDENTIALS_SECRET="opencrane-postgres-bootstrap"
LITELLM_POSTGRES_OWNER="litellm"
LITELLM_POSTGRES_CREDENTIALS_SECRET="litellm-postgres-bootstrap"
POSTGRES_ADMIN_NAME="opencrane_database_admin"
POSTGRES_ADMIN_CREDENTIALS_SECRET="opencrane-admin-postgres-bootstrap"
POSTGRES_BOOTSTRAP_BASELINE_SHA256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP="opencrane-target-baseline"
POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY="target-baseline.sql"
POSTGRES_KUBERNETES_API_ARGS=(--test-kubernetes-api-arg)
TIMEOUT=300
PRISMA_MIGRATOR_IMAGE="ghcr.io/elewa-git/opencrane-prisma-migrator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
FROM_RELEASE_VERSION="0.9.2"
OIDC_ISSUER_URL="https://issuer.example.test/"
POSTGRES_VALUES_FILE=""
STORAGE_CLASS=""
helm()
{
  return 1
}
source "$ORCHESTRATOR"
build_postgres_release_args true false true
migration_silo_argument_count=0
for postgres_argument in "${POSTGRES_ARGS[@]}"; do
  if [[ "$postgres_argument" == "migration.siloId=testv4" ]]; then
    migration_silo_argument_count="$((migration_silo_argument_count + 1))"
  fi
done
[[ "$migration_silo_argument_count" -eq 1 ]]

echo "database migration direct-path contract: PASS"
