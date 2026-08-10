#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
ORCHESTRATOR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-orchestrator.sh"
BACKUP_SCRIPT="$ROOT_DIR/apps/postgres/scripts/create-pre-migration-backup.sh"

bash -n "$DEPLOY_SCRIPT"
bash -n "$ORCHESTRATOR"
bash -n "$BACKUP_SCRIPT"
grep -q -- '--release-version' "$DEPLOY_SCRIPT"
grep -q -- '--from-release-version' "$DEPLOY_SCRIPT"
grep -q 'DATABASE_RELEASE_TRANSITION=.*DATABASE_TRANSITION_RESOLVER' "$DEPLOY_SCRIPT"
grep -q 'automatic database migration permits only an adjacent minor transition' \
  "$ROOT_DIR/scripts/release-versioning/database-validation.mjs"
grep -q 'run_database_release_transition' "$DEPLOY_SCRIPT"
grep -q 'fence_existing_opencrane_server' "$ORCHESTRATOR"
grep -q 'TIMEOUT_SECONDS must be an integer from 1 through 3600' "$DEPLOY_SCRIPT"
grep -q 'migrationFence.active=true' "$ORCHESTRATOR"
grep -q 'migrationFence.active=false' "$DEPLOY_SCRIPT"
grep -q 'POSTGRES_BOOTSTRAP_BASELINE_SHA256=.*existing_postgres_values' "$DEPLOY_SCRIPT"
grep -q 'CNPG recovery evidence completed before migration' "$ORCHESTRATOR"
grep -q 'install_postgres_release false false' "$ORCHESTRATOR"
grep -q 'install_postgres_release true true' "$ORCHESTRATOR"
grep -q -- '--set "migration.enabled=$migration_enabled"' "$ORCHESTRATOR"
grep -q -- '--set "privileges.enabled=$privileges_enabled"' "$ORCHESTRATOR"

# The deploy timeout is the single operator-owned budget. Both Helm hook Jobs inherit it, while
# Helm receives the Job deadline grace plus a final status-propagation margin. This prevents
# Helm's five-minute default from aborting a valid longer migration and leaving the server fenced.
TEST_POSTGRES_ARGS="$(mktemp)"
export TEST_POSTGRES_ARGS
(
  source "$ORCHESTRATOR"
  TIMEOUT=37
  POSTGRES_RELEASE=opencrane-postgres
  POSTGRES_CHART_DIR=/postgres-chart
  NAMESPACE=opencrane
  POSTGRES_OWNER=opencrane
  POSTGRES_CREDENTIALS_SECRET=opencrane-db
  OBOT_POSTGRES_OWNER=obot
  OBOT_POSTGRES_CREDENTIALS_SECRET=obot-db
  LITELLM_POSTGRES_OWNER=litellm
  LITELLM_POSTGRES_CREDENTIALS_SECRET=litellm-db
  POSTGRES_ADMIN_NAME=postgres
  POSTGRES_ADMIN_CREDENTIALS_SECRET=postgres-admin
  POSTGRES_BOOTSTRAP_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP=baseline
  POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY=target-baseline.sql
  DATABASE_TARGET_SCHEMA_VERSION=0.8.0
  DATABASE_TARGET_BASELINE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  POSTGRES_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  DATABASE_PREVIOUS_MIGRATION_AVAILABLE=true
  DATABASE_PREVIOUS_MIGRATION_ID=0.7.0-to-0.8.0
  DATABASE_PREVIOUS_SCHEMA_VERSION=0.7.0
  DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  DATABASE_PREVIOUS_MIGRATION_SQL_SHA256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  POSTGRES_MIGRATION_IMAGE=postgres@example.invalid
  DATABASE_MIGRATION_CONFIG_MAP=migration
  POSTGRES_KUBERNETES_API_ARGS=(--set-string networkPolicy.kubernetesApiServerCidrs[0]=10.0.0.1/32)
  POSTGRES_VALUES_FILE=
  STORAGE_CLASS=
  helm() { return 1; }
  build_postgres_release_args true true
  printf '%s\n' "${POSTGRES_ARGS[@]}" >"$TEST_POSTGRES_ARGS"
)
grep -Fxq -- '--wait' "$TEST_POSTGRES_ARGS"
grep -Fxq -- '--timeout' "$TEST_POSTGRES_ARGS"
grep -Fxq -- '97s' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'migration.timeoutSeconds=37' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'migration.jobDeadlineGraceSeconds=30' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'privileges.timeoutSeconds=37' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'privileges.jobDeadlineGraceSeconds=30' "$TEST_POSTGRES_ARGS"

fence_line="$(grep -n 'fence_existing_opencrane_server$' "$ORCHESTRATOR" | tail -1 | cut -d: -f1)"
backup_line="$(grep -n 'backup_evidence=.*POSTGRES_MIGRATION_BACKUP' "$ORCHESTRATOR" | cut -d: -f1)"
migration_line="$(grep -n 'install_postgres_release true true' "$ORCHESTRATOR" | cut -d: -f1)"
restore_line="$(grep -n 'migrationFence.active=false' "$DEPLOY_SCRIPT" | tail -1 | cut -d: -f1)"
if (( fence_line >= backup_line || backup_line >= migration_line )); then
  echo "database migration fence, backup, mutation, and restore ordering regressed" >&2
  exit 1
fi
if (( restore_line == 0 )); then
  echo "database migration fence has no success-only restore path" >&2
  exit 1
fi

# Fresh/current paths must keep the migration hook disabled as a real Helm boolean. A quoted
# "false" is truthy in Go templates and would accidentally execute migration SQL.
TEST_CURRENT_SENTINEL="$(mktemp)"
export TEST_CURRENT_SENTINEL
rm -f "$TEST_CURRENT_SENTINEL"
(
  source "$ORCHESTRATOR"
  POSTGRES_CLUSTER_EXISTS=1
  DATABASE_TRANSITION_KIND=current
  install_postgres_release()
  {
    [[ "$1" == "false" && "$2" == "true" ]]
    printf '%s\n' current >"$TEST_CURRENT_SENTINEL"
  }
  run_database_release_transition
)
grep -q '^current$' "$TEST_CURRENT_SENTINEL"

if (
  source "$ORCHESTRATOR"
  RELEASE=opencrane
  NAMESPACE=opencrane
  err() { :; }
  helm() { return 1; }
  kubectl()
  {
    case "${2:-}" in
      deployment) printf '%s\n' 'deployment.apps/opencrane-opencrane-server' ;;
      pods|replicasets|jobs) return 0 ;;
      *) echo "unexpected kubectl call: $*" >&2; return 1 ;;
    esac
  }
  fence_existing_opencrane_server
); then
  echo "database migration accepted an unfenced orphan server deployment" >&2
  exit 1
fi

# An active Helm release is not itself a write fence. Even after its Deployment reaches zero,
# every matching Pod/Job must be terminal and every ReplicaSet must be zero-scaled and owned by
# that exact Deployment UID.
if (
  source "$ORCHESTRATOR"
  RELEASE=opencrane
  NAMESPACE=opencrane
  CHART_DIR=/chart
  FROM_RELEASE_VERSION=0.7.0
  RELEASE_VERSION=0.8.0
  TIMEOUT=0
  err() { :; }
  log() { :; }
  helm()
  {
    if [[ "$1 $2" == "get values" ]]; then printf '%s\n' '{"clustertenantManager":{"replicas":1}}'; fi
    return 0
  }
  kubectl()
  {
    if [[ "$*" == *"get deployment opencrane-opencrane-server"*"-o name"* ]]; then
      printf '%s\n' 'deployment.apps/opencrane-opencrane-server'
    elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"metadata.uid"* ]]; then
      printf '%s' 'deployment-uid'
    elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"spec.replicas"* ]]; then
      printf '%s' '0'
    elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"status.replicas"* ]]; then
      printf '%s' '0'
    elif [[ "$*" == *"get pods"* ]]; then
      printf '%s' '{"items":[{"status":{"phase":"Running"}}]}'
    elif [[ "$*" == *"get replicasets"* ]]; then
      printf '%s' '{"items":[{"spec":{"replicas":0},"metadata":{"ownerReferences":[{"kind":"Deployment","uid":"deployment-uid"}]}}]}'
    elif [[ "$*" == *"get jobs"* ]]; then
      printf '%s' '{"items":[]}'
    else
      echo "unexpected kubectl call: $*" >&2
      return 1
    fi
  }
  fence_existing_opencrane_server
); then
  echo "database migration accepted an active orphan server pod after Helm fencing" >&2
  exit 1
fi

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"; rm -f "$TEST_CURRENT_SENTINEL" "$TEST_POSTGRES_ARGS"' EXIT
export TEST_DIR
mkdir -p "$TEST_DIR/bin"

# Exercise the real migration branch through its public orchestration function. This proves the
# executable order and argument binding rather than inferring them from source-line positions.
(
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=0
  NAMESPACE=opencrane
  POSTGRES_RELEASE=opencrane-postgres
  POSTGRES_MIGRATION_BACKUP=/backup-owner.sh
  TIMEOUT=37
  log() { :; }
  err() { :; }
  postgres_release_render_has_recovery() { return 0; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$TEST_DIR/migration-order"; }
  install_postgres_release() { printf 'install %s %s\n' "$1" "$2" >>"$TEST_DIR/migration-order"; }
  bash()
  {
    printf 'backup %s %s %s %s\n' "$1" "$2" "$3" "$4" >>"$TEST_DIR/migration-order"
    printf '%s\n' verified-backup
  }
  run_database_release_transition
)
cat >"$TEST_DIR/expected-migration-order" <<'EOF'
fence
install false false
backup /backup-owner.sh opencrane opencrane-postgres 37
install true true
EOF
cmp "$TEST_DIR/expected-migration-order" "$TEST_DIR/migration-order"

cat >"$TEST_DIR/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "get scheduledbackup")
    printf '%s' '{"spec":{"method":"plugin","pluginConfiguration":{"name":"barman-cloud.cloudnative-pg.io","parameters":{"barmanObjectName":"opencrane"}}}}'
    ;;
  "create -f")
    cat >"$TEST_DIR/created-backup.json"
    ;;
  "get backup")
    if [[ "$*" == *status.phase* ]]; then printf '%s' "${FAKE_BACKUP_PHASE:-completed}";
    elif [[ "$*" == *status.backupId* ]]; then printf '%s' backup-id;
    else printf '%s' 'kind: Backup'; fi
    ;;
  *) echo "unexpected kubectl call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TEST_DIR/bin/kubectl"

PATH="$TEST_DIR/bin:$PATH" bash "$BACKUP_SCRIPT" opencrane opencrane-postgres 2 >"$TEST_DIR/evidence"
grep -q 'opencrane-postgres-pre-migration-' "$TEST_DIR/evidence"
[[ "$(jq -r '.metadata.labels["opencrane.ai/purpose"]' "$TEST_DIR/created-backup.json")" == "pre-database-migration" ]]
if FAKE_BACKUP_PHASE=failed PATH="$TEST_DIR/bin:$PATH" bash "$BACKUP_SCRIPT" \
  opencrane opencrane-postgres 2 >/dev/null 2>&1; then
  echo "automatic migration accepted failed CNPG recovery evidence" >&2
  exit 1
fi
malicious_timeout='arr[$(touch '"$TEST_DIR"'/arithmetic-executed)0]'
if PATH="$TEST_DIR/bin:$PATH" bash "$BACKUP_SCRIPT" opencrane opencrane-postgres \
  "$malicious_timeout" >/dev/null 2>&1; then
  echo "automatic migration accepted a non-numeric backup timeout" >&2
  exit 1
fi
[[ ! -e "$TEST_DIR/arithmetic-executed" ]] || {
  echo "backup timeout reached recursive arithmetic evaluation" >&2
  exit 1
}

echo "database migration deploy contract: PASS"
