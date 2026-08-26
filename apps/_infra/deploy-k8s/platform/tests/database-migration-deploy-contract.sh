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

source "$ORCHESTRATOR"

NAMESPACE="opencrane-test"
TIMEOUT=3
KUBECTL_ARGUMENTS_FILE="$(mktemp)"
LAST_ERROR=""
trap 'rm -f -- "$KUBECTL_ARGUMENTS_FILE"' EXIT

err()
{
  LAST_ERROR="$*"
}

# Advance Bash's clock without delaying the contract test.
sleep()
{
  SECONDS="$((SECONDS + $1))"
}

# Prove a missing resource is retried until kubectl returns its expected name.
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  if [[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -ge 2 ]]; then
    printf '%s\n' 'opencrane-test-pooler'
  fi
}

wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 2 ]]
[[ "$(sed -n '1p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=3s" ]]
[[ "$(sed -n '2p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=2s" ]]
[[ -z "$LAST_ERROR" ]]

# Prove a successful kubectl warning does not hide the resource name printed afterward.
TIMEOUT=1
: >"$KUBECTL_ARGUMENTS_FILE"
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  printf '%s\n' 'Warning: use tokens from the TokenRequest API' >&2
  printf '%s\n' 'opencrane-test-pooler'
}

wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ -z "$LAST_ERROR" ]]

# Prove repeated absence consumes the shared deadline and returns the caller's creation error.
TIMEOUT=2
: >"$KUBECTL_ARGUMENTS_FILE"
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
}

if wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"; then
  echo "creation wait accepted a resource that never appeared" >&2
  exit 1
fi
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 2 ]]
[[ "$(sed -n '1p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=2s" ]]
[[ "$(sed -n '2p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=1s" ]]
[[ "$LAST_ERROR" == "pooler was not created" ]]

# Prove a slow kubectl request cannot add another sleep after the deadline expires.
TIMEOUT=2
SECONDS=0
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  command sleep 2
}

if wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"; then
  echo "creation wait accepted a resource that never appeared" >&2
  exit 1
fi
[[ "$SECONDS" -eq "$TIMEOUT" ]]
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ "$LAST_ERROR" == "pooler was not created" ]]

# Prove an API error stops polling instead of being mistaken for an absent resource.
TIMEOUT=30
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  printf '%s\n' 'Error from server (Forbidden): deployments.apps is forbidden' >&2
  return 1
}

if wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"; then
  echo "creation wait ignored a terminal kubectl error" >&2
  exit 1
fi
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ "$(sed -n '1p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=30s" ]]
[[ "$LAST_ERROR" == *"kubectl get failed: Error from server (Forbidden)"* ]]

# Prove readiness checks other than creation still use kubectl wait unchanged.
TIMEOUT=2
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  [[ "$*" == "wait --for=condition=available deployment/opencrane-test-pooler -n opencrane-test --timeout=2s" ]]
}

wait_for_postgres_resource condition=available "deployment/opencrane-test-pooler" "pooler was not available"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ -z "$LAST_ERROR" ]]

echo "database migration direct-path contract: PASS"
