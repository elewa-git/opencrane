#!/usr/bin/env bash
set -euo pipefail

report_contract_failure()
{
  local failure_line="$1"
  local failure_command="$2"
  local failure_status="$3"
  if [[ "$-" == *e* ]]; then
    printf 'database migration deploy contract failed at line %s with status %s: %s\n' \
      "$failure_line" "$failure_status" "$failure_command" >&2
  fi
  return "$failure_status"
}

trap 'report_contract_failure "$LINENO" "$BASH_COMMAND" "$?"' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
ORCHESTRATOR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-orchestrator.sh"
RECOVERY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-recovery.sh"
INVITATION_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/invitation-signing-secret.sh"
FINALIZATION="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-convergence-policy.sh"
BACKUP_SCRIPT="$ROOT_DIR/apps/postgres/scripts/create-pre-migration-backup.sh"
LIVE_ORIGIN=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
export LIVE_ORIGIN

bash -n "$DEPLOY_SCRIPT"
bash -n "$RECOVERY"
bash -n "$INVITATION_HELPER"
bash -n "$ORCHESTRATOR"
bash -n "$FINALIZATION"
bash -n "$POLICY"
bash -n "$BACKUP_SCRIPT"
source "$POLICY"
source "$INVITATION_HELPER"

# The orchestrator contract exercises ordering, not the separate read-only CNPG probe.
verify_database_pg_cron_preflight()
{
  :
}

verify_database_pg_cron_server_preflight()
{
  :
}

verify_database_superuser_access_disabled()
{
  :
}

grep -q -- '--release-version' "$DEPLOY_SCRIPT"
grep -q -- '--from-release-version' "$DEPLOY_SCRIPT"
grep -q 'DATABASE_RELEASE_TRANSITION=.*DATABASE_TRANSITION_RESOLVER' "$DEPLOY_SCRIPT"
grep -q 'POSTGRES_OPERAND_IMAGE=.*operandImage' "$DEPLOY_SCRIPT"
grep -Eq 'local _images=.*POSTGRES_OPERAND_IMAGE' "$DEPLOY_SCRIPT"
grep -q 'target release must bind the PostgreSQL operand' "$DEPLOY_SCRIPT"
grep -q 'source && migrationOwner.database.schemaVersion !== source.database.schemaVersion' \
  "$ROOT_DIR/scripts/release-versioning/database-validation.mjs"
! grep -q 'automatic database migration permits only an adjacent minor transition' \
  "$ROOT_DIR/scripts/release-versioning/database-validation.mjs"
grep -q 'run_database_release_transition' "$DEPLOY_SCRIPT"
grep -q 'fence_existing_opencrane_server' "$RECOVERY"
grep -q 'DATABASE_CARRY_FORWARD_RELEASE=' "$DEPLOY_SCRIPT"
grep -q 'valid only for an approved carry-forward repair' "$ORCHESTRATOR"
! grep -q 'OPENCRANE_ALLOW_UNBACKED_DATABASE_MIGRATION' "$DEPLOY_SCRIPT"
invitation_secret_line="$(grep -n 'ensure_invitation_signing_secret "$NAMESPACE" "$INVITATION_SIGNING_SECRET"' "$DEPLOY_SCRIPT" | cut -d: -f1)"
database_transition_line="$(grep -n '^run_database_release_transition$' "$DEPLOY_SCRIPT" | cut -d: -f1)"
(( invitation_secret_line < database_transition_line ))
grep -q 'source "$SCRIPT_DIR/database-convergence-classifier.sh"' "$DEPLOY_SCRIPT"
grep -q 'TIMEOUT_SECONDS must be an integer from 1 through 3600' "$DEPLOY_SCRIPT"
grep -q 'migrationFence.active=true' "$RECOVERY"
grep -q 'migrationFence.active=false' "$DEPLOY_SCRIPT"
grep -q 'POSTGRES_BOOTSTRAP_BASELINE_SHA256=.*existing_postgres_values' "$DEPLOY_SCRIPT"
grep -q 'classify_live_database_convergence' "$ORCHESTRATOR"
grep -q 'capture_pre_fence_main_release_revision' "$RECOVERY"
grep -q 'helm rollback "$RELEASE" "$DATABASE_PRE_FENCE_RELEASE_REVISION"' "$RECOVERY"
grep -q 'helm rollback "$RELEASE" "$DATABASE_FENCED_RELEASE_REVISION"' "$FINALIZATION"
grep -q -- '--ignore-not-found -o name' "$DEPLOY_SCRIPT"
grep -q 'postgres_cluster_status' "$DEPLOY_SCRIPT"
grep -q 'CNPG recovery evidence completed before migration' "$ORCHESTRATOR"
grep -q 'install_postgres_release false false' "$ORCHESTRATOR"
grep -q 'install_postgres_release true true' "$ORCHESTRATOR"
grep -q -- '--set "migration.enabled=$migration_enabled"' "$ORCHESTRATOR"
grep -q -- '--set "privileges.enabled=$privileges_enabled"' "$ORCHESTRATOR"
if rg -n '^[[:space:]]*set[[:space:]]+[-+]e([[:space:];]|$)' \
  "$ORCHESTRATOR" "$RECOVERY" "$FINALIZATION"; then
  echo "database transition modules must not mutate their caller's errexit option" >&2
  exit 1
fi

# The deploy timeout is the single operator-owned budget. Both Helm hook Jobs inherit it, while
# Helm receives the Job deadline grace plus a final status-propagation margin. This prevents
# Helm's five-minute default from aborting a valid longer migration and leaving the server fenced.
TEST_POSTGRES_ARGS="$(mktemp)"
export TEST_POSTGRES_ARGS
(
  source "$RECOVERY"
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
  POSTGRES_OPERAND_IMAGE=ghcr.io/elewa-git/opencrane-postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000
  POSTGRES_BOOTSTRAP_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP=baseline
  POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY=target-baseline.sql
  DATABASE_TARGET_SCHEMA_VERSION=0.8.0
  DATABASE_TARGET_BASELINE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  POSTGRES_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  DATABASE_PREVIOUS_MIGRATION_AVAILABLE=true
  DATABASE_PREVIOUS_MIGRATION_ID=0.7.0-to-0.8.0
  DATABASE_PREVIOUS_SCHEMA_VERSION=0.7.0
  DATABASE_PREVIOUS_TARGET_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON='["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]'
  DATABASE_SELECTED_PROTECTED_BASELINE_SHA256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
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
grep -Fxq -- 'superuserAccess.enabled=false' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'migration.privilegedExtension.enabled=false' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'migration.privilegedExtension.name=' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'image=ghcr.io/elewa-git/opencrane-postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'convergence.previousMigration.sourceTargetBaselineSha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'convergence.previousMigration.sourceProtectedBaselineSha256s=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]' "$TEST_POSTGRES_ARGS"
grep -Fxq -- 'convergence.previousMigration.selectedSourceProtectedBaselineSha256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' "$TEST_POSTGRES_ARGS"

if rg -q 'DATABASE_MIGRATION_CONFIG_MAP="\$\(bash' "$DEPLOY_SCRIPT"; then
  echo "deploy entrypoint still publishes migration SQL before live-state classification" >&2
  exit 1
fi

# Fresh/current paths must keep the migration hook disabled as a real Helm boolean. A quoted
# "false" is truthy in Go templates and would accidentally execute migration SQL.
TEST_CURRENT_SENTINEL="$(mktemp)"
export TEST_CURRENT_SENTINEL
rm -f "$TEST_CURRENT_SENTINEL"
(
  source "$RECOVERY"
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

# A same-release reconciliation still classifies a database with migration history so the
# privilege Job receives the protected origin selected from that completed chain.
TEST_CURRENT_HISTORY_SENTINEL="$(mktemp)"
export TEST_CURRENT_HISTORY_SENTINEL
rm -f "$TEST_CURRENT_HISTORY_SENTINEL"
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  POSTGRES_CLUSTER_EXISTS=1
  DATABASE_TRANSITION_KIND=current
  DATABASE_PREVIOUS_MIGRATION_AVAILABLE=true
  classify_live_database_convergence() { printf 'completed|%s\n' "$LIVE_ORIGIN"; }
  install_postgres_release()
  {
    printf '%s %s %s\n' "$1" "$2" "$DATABASE_SELECTED_PROTECTED_BASELINE_SHA256" \
      >"$TEST_CURRENT_HISTORY_SENTINEL"
  }
  err() { :; }
  run_database_release_transition
)
grep -Fxq "false true $LIVE_ORIGIN" "$TEST_CURRENT_HISTORY_SENTINEL"

if (
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  source "$FINALIZATION"
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
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  source "$FINALIZATION"
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
trap 'rm -rf "$TEST_DIR"; rm -f "$TEST_CURRENT_SENTINEL" "$TEST_CURRENT_HISTORY_SENTINEL" "$TEST_POSTGRES_ARGS"' EXIT
export TEST_DIR
mkdir -p "$TEST_DIR/bin"

# Exercise the successful public shell boundaries with fake Helm and Kubernetes APIs. The real
# fence proves the exact Deployment UID, owned zero-scaled ReplicaSet, and quiescent Pod/Job sets;
# the real finalization helpers capture and clear that fence, restart consumers, and wait for every
# final readiness boundary in order.
SUCCESS_CALLS="$TEST_DIR/public-success.calls"
export SUCCESS_CALLS
(
  source "$RECOVERY"
  source "$FINALIZATION"
  RELEASE=opencrane
  NAMESPACE=opencrane
  CHART_DIR=/chart
  FROM_RELEASE_VERSION=0.7.0
  RELEASE_VERSION=0.8.0
  TIMEOUT=37
  MEMBERSHIP_MODE=standalone
  INVITATION_SIGNING_SECRET=opencrane-invitation-signing
  DATABASE_FENCED_RELEASE_REVISION=""
  BOUNDARY_PHASE=fence
  helm()
  {
    if [[ "$1" == "status" && "$*" == *"-o json"* ]]; then
      printf '%s\n' helm-capture-fenced >>"$SUCCESS_CALLS"
      printf '%s\n' '{"version":13}'
    elif [[ "$1" == "status" ]]; then
      printf '%s\n' helm-status-pre-fence >>"$SUCCESS_CALLS"
    elif [[ "$1 $2" == "get values" ]]; then
      printf '%s\n' helm-get-values >>"$SUCCESS_CALLS"
      printf '%s\n' '{"clustertenantManager":{"replicas":2}}'
    elif [[ "$1" == "upgrade" && "$*" == *"migrationFence.active=true"* \
      && "$*" == *"clustertenantManager.membership.mode=standalone"* \
      && "$*" == *"clustertenantManager.membership.standalone.invitationSigningExistingSecret=opencrane-invitation-signing"* \
      && "$*" == *"clustertenantManager.membership.standalone.invitationSigningKeyKey=key"* ]]; then
      printf '%s\n' helm-fence >>"$SUCCESS_CALLS"
    elif [[ "$1" == "upgrade" && "$*" == *"migrationFence.active=false"* ]]; then
      printf '%s\n' helm-unfence >>"$SUCCESS_CALLS"
    else
      printf 'unexpected helm call: %s\n' "$*" >&2
      return 1
    fi
  }
  kubectl()
  {
    local deployment_name
    if [[ "$BOUNDARY_PHASE" == "fence" ]]; then
      if [[ "$*" == *"get deployment opencrane-opencrane-server"*"-o name"* ]]; then
        printf '%s\n' fence-deployment >>"$SUCCESS_CALLS"
        printf '%s\n' deployment.apps/opencrane-opencrane-server
      elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"metadata.uid"* ]]; then
        printf '%s\n' fence-uid >>"$SUCCESS_CALLS"
        printf '%s' deployment-uid
      elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"spec.replicas"* ]]; then
        printf '%s\n' fence-desired-replicas >>"$SUCCESS_CALLS"
        printf '%s' 0
      elif [[ "$*" == *"get deployment opencrane-opencrane-server"*"status.replicas"* ]]; then
        printf '%s\n' fence-live-replicas >>"$SUCCESS_CALLS"
        printf '%s' 0
      elif [[ "$*" == *"get pods"* ]]; then
        printf '%s\n' fence-pods >>"$SUCCESS_CALLS"
        printf '%s\n' '{"items":[]}'
      elif [[ "$*" == *"get replicasets"* ]]; then
        printf '%s\n' fence-replicasets >>"$SUCCESS_CALLS"
        printf '%s\n' '{"items":[{"spec":{"replicas":0},"metadata":{"ownerReferences":[{"kind":"Deployment","uid":"deployment-uid"}]}}]}'
      elif [[ "$*" == *"get jobs"* ]]; then
        printf '%s\n' fence-jobs >>"$SUCCESS_CALLS"
        printf '%s\n' '{"items":[]}'
      else
        printf 'unexpected fence kubectl call: %s\n' "$*" >&2
        return 1
      fi
      return
    fi
    if [[ "$1 $2" == "get deployment/"* ]]; then
      deployment_name="${2#deployment/}"
      printf 'inventory %s\n' "$deployment_name" >>"$SUCCESS_CALLS"
      printf 'deployment.apps/%s\n' "$deployment_name"
    elif [[ "$1 $2" == "patch deployment/"* ]]; then
      deployment_name="${2#deployment/}"
      if [[ "$*" != *'opencrane.ai/database-connection-checksum'* || "$*" != *'checksum-value'* ]]; then
        printf 'unexpected finalization patch payload: %s\n' "$*" >&2
        return 1
      fi
      printf 'patch %s\n' "$deployment_name" >>"$SUCCESS_CALLS"
    elif [[ "$1 $2" == "rollout status" ]]; then
      deployment_name="${3#deployment/}"
      printf 'rollout %s\n' "$deployment_name" >>"$SUCCESS_CALLS"
    else
      printf 'unexpected finalization kubectl call: %s\n' "$*" >&2
      return 1
    fi
  }
  err() { :; }
  log() { :; }
  _wait_for_release_certificate() { printf '%s\n' certificate-ready >>"$SUCCESS_CALLS"; }
  _post_deploy_verify() { printf '%s\n' verification-passed >>"$SUCCESS_CALLS"; }

  fence_existing_opencrane_server
  [[ "$DATABASE_FENCE_PRIOR_REPLICAS" == "2" ]]
  capture_fenced_main_release_revision
  [[ "$DATABASE_FENCED_RELEASE_REVISION" == "13" ]]
  BOUNDARY_PHASE=finalization
  run_opencrane_finalization_stage helm upgrade opencrane /chart \
    --set clustertenantManager.replicas=2 --set migrationFence.active=false
  run_opencrane_finalization_stage roll_database_consumers_for_finalization opencrane 37 \
    checksum-value opencrane-opencrane-server opencrane-litellm
  run_opencrane_finalization_stage wait_for_final_deployment_if_present opencrane-clustertenant-manager
  run_opencrane_finalization_stage _wait_for_release_certificate
  run_opencrane_finalization_stage _post_deploy_verify
)
printf '%s\n' \
  helm-status-pre-fence \
  helm-get-values \
  helm-fence \
  fence-deployment \
  fence-uid \
  fence-desired-replicas \
  fence-live-replicas \
  fence-pods \
  fence-replicasets \
  fence-jobs \
  helm-capture-fenced \
  helm-unfence \
  'inventory opencrane-opencrane-server' \
  'patch opencrane-opencrane-server' \
  'inventory opencrane-litellm' \
  'patch opencrane-litellm' \
  'inventory opencrane-opencrane-server' \
  'rollout opencrane-opencrane-server' \
  'inventory opencrane-litellm' \
  'rollout opencrane-litellm' \
  'inventory opencrane-clustertenant-manager' \
  'rollout opencrane-clustertenant-manager' \
  certificate-ready \
  verification-passed >"$TEST_DIR/public-success.expected"
cmp "$TEST_DIR/public-success.expected" "$SUCCESS_CALLS"
! grep -q '^helm rollback ' "$SUCCESS_CALLS"

# Current and completed evidence are both adoption-safe: reconcile privileges, but do not publish
# SQL, capture a fence revision, fence the server, back up, or invoke migration.
for state in current completed; do
  STATE_CALLS="$TEST_DIR/${state}.calls"
  export STATE_CALLS state
  (
    source "$RECOVERY"
    source "$ORCHESTRATOR"
    POSTGRES_CLUSTER_EXISTS=1
    DATABASE_TRANSITION_KIND=migration
    classify_live_database_convergence() { printf '%s|%s\n' "$state" "$LIVE_ORIGIN"; }
    adopt_matching_existing_database_fence() { :; }
    install_postgres_release() { printf 'install %s %s\n' "$1" "$2" >>"$STATE_CALLS"; }
    publish_database_migration_config_map() { printf '%s\n' publish >>"$STATE_CALLS"; }
    capture_pre_fence_main_release_revision() { printf '%s\n' capture >>"$STATE_CALLS"; }
    fence_existing_opencrane_server() { printf '%s\n' fence >>"$STATE_CALLS"; }
    log() { :; }
    err() { :; }
    run_database_release_transition
  )
  printf 'install false true\n' >"$TEST_DIR/${state}.expected"
  cmp "$TEST_DIR/${state}.expected" "$STATE_CALLS"
done

# A crash after migration but before final application Helm leaves an exact active fence. Completed
# re-entry adopts that matching fence and carries its positive prior replica count into finalization.
REENTRY_CALLS="$TEST_DIR/completed-reentry.calls"
export REENTRY_CALLS
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  RELEASE=opencrane
  NAMESPACE=opencrane
  FROM_RELEASE_VERSION=0.7.0
  RELEASE_VERSION=0.8.0
  POSTGRES_CLUSTER_EXISTS=1
  DATABASE_TRANSITION_KIND=migration
  classify_live_database_convergence() { printf 'completed|%s\n' "$LIVE_ORIGIN"; }
  helm()
  {
    if [[ "$1" == "status" ]]; then printf '%s\n' '{"version":13}'; return 0; fi
    if [[ "$1 $2" == "get values" ]]; then
      printf '%s\n' '{"clustertenantManager":{"replicas":0},"migrationFence":{"active":true,"previousReplicas":2,"fromReleaseVersion":"0.7.0","toReleaseVersion":"0.8.0"}}'
      return 0
    fi
    return 1
  }
  install_postgres_release()
  {
    printf 'install %s %s\n' "$1" "$2" >>"$REENTRY_CALLS"
    printf 'prior %s\n' "$DATABASE_FENCE_PRIOR_REPLICAS" >>"$REENTRY_CALLS"
  }
  log() { :; }
  err() { :; }
  run_database_release_transition
)
printf '%s\n' 'install false true' 'prior 2' >"$TEST_DIR/completed-reentry.expected"
cmp "$TEST_DIR/completed-reentry.expected" "$REENTRY_CALLS"

# Readable incompatible evidence and unreadable or ambiguous evidence all fail before publication
# or fencing. The classifier's original nonzero status remains observable.
for state in incompatible ambiguous; do
  STATE_CALLS="$TEST_DIR/${state}.calls"
  export STATE_CALLS state
  set +e
  (
    source "$RECOVERY"
    source "$ORCHESTRATOR"
    POSTGRES_CLUSTER_EXISTS=1
    DATABASE_TRANSITION_KIND=migration
    if [[ "$state" == "ambiguous" ]]; then
      classify_live_database_convergence() { printf 'source\ncurrent\n'; }
    else
      classify_live_database_convergence() { printf '%s|%s\n' "$state" "$LIVE_ORIGIN"; }
    fi
    publish_database_migration_config_map() { printf '%s\n' publish >>"$STATE_CALLS"; }
    capture_pre_fence_main_release_revision() { printf '%s\n' capture >>"$STATE_CALLS"; }
    fence_existing_opencrane_server() { printf '%s\n' fence >>"$STATE_CALLS"; }
    log() { :; }
    err() { :; }
    run_database_release_transition
  )
  state_status=$?
  set -e
  (( state_status != 0 ))
  [[ ! -s "$STATE_CALLS" ]]
done

STATE_CALLS="$TEST_DIR/unreadable.calls"
export STATE_CALLS
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  POSTGRES_CLUSTER_EXISTS=1
  DATABASE_TRANSITION_KIND=migration
  classify_live_database_convergence() { return 19; }
  publish_database_migration_config_map() { printf '%s\n' publish >>"$STATE_CALLS"; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$STATE_CALLS"; }
  log() { :; }
  err() { :; }
  [[ "$-" == *e* ]]
  if run_database_release_transition; then
    echo "unreadable live convergence evidence unexpectedly succeeded" >&2
    exit 1
  else
    unreadable_status=$?
  fi
  [[ "$-" == *e* ]]
  [[ "$unreadable_status" == "19" ]]
  [[ ! -s "$STATE_CALLS" ]]
)

# Exercise the successful live-source branch through its public orchestration function. This proves
# classification -> revision capture -> fence -> pg_cron-ready server -> SQL publication -> backup -> migration.
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=1
  NAMESPACE=opencrane
  POSTGRES_RELEASE=opencrane-postgres
  POSTGRES_MIGRATION_BACKUP=/backup-owner.sh
  TIMEOUT=37
  classify_live_database_convergence() { printf 'source|%s\n' "$LIVE_ORIGIN"; }
  publish_database_migration_config_map() { printf '%s\n' publish >>"$TEST_DIR/migration-order"; }
  capture_pre_fence_main_release_revision()
  {
    DATABASE_PRE_FENCE_RELEASE_REVISION=12
    printf '%s\n' capture >>"$TEST_DIR/migration-order"
  }
  log() { :; }
  err() { :; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$TEST_DIR/migration-order"; }
  install_postgres_release()
  {
    printf 'install %s %s %s\n' "$1" "$2" "$DATABASE_SELECTED_PROTECTED_BASELINE_SHA256" \
      >>"$TEST_DIR/migration-order"
  }
  bash()
  {
    printf 'backup %s %s %s %s\n' "$1" "$2" "$3" "$4" >>"$TEST_DIR/migration-order"
    printf '%s\n' verified-backup
  }
  run_database_release_transition
)
printf '%s\n' \
  capture \
  fence \
  "install false false $LIVE_ORIGIN" \
  publish \
  'backup /backup-owner.sh opencrane opencrane-postgres 37' \
  "install true true $LIVE_ORIGIN" >"$TEST_DIR/expected-migration-order"
cmp "$TEST_DIR/expected-migration-order" "$TEST_DIR/migration-order"

(
  source "$ORCHESTRATOR"
  ALLOW_UNBACKED_DATABASE_MIGRATION=1
  DATABASE_TRANSITION_KIND=migration
  DATABASE_CARRY_FORWARD_RELEASE=""
  err() { :; }
  if validate_unbacked_database_migration_override; then
    printf '%s\n' 'ordinary migration accepted the unbacked override' >&2
    exit 1
  fi
  DATABASE_CARRY_FORWARD_RELEASE=0.9.0
  validate_unbacked_database_migration_override
  DATABASE_TRANSITION_KIND=current
  if validate_unbacked_database_migration_override; then
    printf '%s\n' 'current transition accepted the unbacked override' >&2
    exit 1
  fi
)

UNBACKED_CALLS="$TEST_DIR/unbacked-migration.calls"
export UNBACKED_CALLS
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=1
  ALLOW_UNBACKED_DATABASE_MIGRATION=1
  classify_live_database_convergence() { printf 'source|%s\n' "$LIVE_ORIGIN"; }
  publish_database_migration_config_map() { printf '%s\n' publish >>"$UNBACKED_CALLS"; }
  capture_pre_fence_main_release_revision() { DATABASE_PRE_FENCE_RELEASE_REVISION=12; printf '%s\n' capture >>"$UNBACKED_CALLS"; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$UNBACKED_CALLS"; }
  install_postgres_release() { printf 'install %s %s\n' "$1" "$2" >>"$UNBACKED_CALLS"; }
  bash() { printf '%s\n' unexpected-backup >>"$UNBACKED_CALLS"; return 1; }
  log() { printf 'log %s\n' "$*" >>"$UNBACKED_CALLS"; }
  err() { :; }
  run_database_release_transition
)
printf '%s\n' \
  capture \
  fence \
  'install false false' \
  publish \
  'log WARNING: operator explicitly allowed this database migration without recovery-backup evidence.' \
  'install true true' >"$TEST_DIR/unbacked-migration.expected"
cmp "$TEST_DIR/unbacked-migration.expected" "$UNBACKED_CALLS"
! grep -q unexpected-backup "$UNBACKED_CALLS"

# Missing-Cluster recovery fails before a fence unless the PostgreSQL render contains an explicit
# physical recovery source. Once admitted, it fences before restoring, classifies the live restored
# database, and only then publishes SQL.
MISSING_CALLS="$TEST_DIR/missing-no-recovery.calls"
export MISSING_CALLS
set +e
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=0
  postgres_release_render_has_recovery() { return 1; }
  capture_pre_fence_main_release_revision() { printf '%s\n' capture >>"$MISSING_CALLS"; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$MISSING_CALLS"; }
  log() { :; }
  err() { :; }
  run_database_release_transition
)
missing_status=$?
set -e
(( missing_status != 0 ))
[[ ! -s "$MISSING_CALLS" ]]

(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=0
  NAMESPACE=opencrane
  POSTGRES_RELEASE=opencrane-postgres
  POSTGRES_MIGRATION_BACKUP=/backup-owner.sh
  TIMEOUT=37
  postgres_release_render_has_recovery() { printf '%s\n' recovery-render >>"$TEST_DIR/missing-order"; }
  capture_pre_fence_main_release_revision() { DATABASE_PRE_FENCE_RELEASE_REVISION=12; printf '%s\n' capture >>"$TEST_DIR/missing-order"; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$TEST_DIR/missing-order"; }
  install_postgres_release() { printf 'install %s %s\n' "$1" "$2" >>"$TEST_DIR/missing-order"; }
  classify_live_database_convergence() { printf '%s\n' classify >>"$TEST_DIR/missing-order"; printf 'source|%s\n' "$LIVE_ORIGIN"; }
  publish_database_migration_config_map() { printf '%s\n' publish >>"$TEST_DIR/missing-order"; }
  bash()
  {
    printf '%s\n' backup >>"$TEST_DIR/missing-order"
    printf '%s\n' verified-backup
  }
  database_migration_job_is_terminal_or_absent() { return 0; }
  log() { :; }
  err() { :; }
  run_database_release_transition
)
printf '%s\n' \
  recovery-render \
  capture \
  fence \
  'install false false' \
  classify \
  publish \
  backup \
  'install true true' >"$TEST_DIR/missing-expected"
cmp "$TEST_DIR/missing-expected" "$TEST_DIR/missing-order"

# Recovery is exhaustive across every readable convergence state. Only an exact source state with
# a terminal/absent migration Job may issue the exact Helm rollback command, while the original
# post-fence failure status is always returned.
for state in current completed incompatible source; do
  RECOVERY_CALLS="$TEST_DIR/recovery-${state}.calls"
  export RECOVERY_CALLS state
  set +e
  (
    source "$RECOVERY"
    source "$ORCHESTRATOR"
    RELEASE=opencrane
    NAMESPACE=opencrane
    TIMEOUT=37
    DATABASE_PRE_FENCE_RELEASE_REVISION=12
    database_migration_job_is_terminal_or_absent() { return 0; }
    classify_live_database_convergence() { printf '%s|%s\n' "$state" "$LIVE_ORIGIN"; }
    helm() { printf 'helm %s\n' "$*" >>"$RECOVERY_CALLS"; }
    log() { :; }
    err() { :; }
    recover_failed_database_transition 23
  )
  recovery_status=$?
  set -e
  [[ "$recovery_status" == "23" ]]
  if [[ "$state" == "source" ]]; then
    grep -Fxq 'helm rollback opencrane 12 --namespace opencrane --wait --timeout 37s --force-conflicts' "$RECOVERY_CALLS"
  else
    [[ ! -s "$RECOVERY_CALLS" ]]
  fi
done

# Unreadable recovery evidence leaves the fence active and does not mask the original status.
RECOVERY_CALLS="$TEST_DIR/recovery-unreadable.calls"
export RECOVERY_CALLS
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  database_migration_job_is_terminal_or_absent() { return 0; }
  classify_live_database_convergence() { return 41; }
  helm() { printf 'helm %s\n' "$*" >>"$RECOVERY_CALLS"; }
  log() { :; }
  err() { :; }
  [[ "$-" == *e* ]]
  if recover_failed_database_transition 23; then
    echo "unreadable recovery evidence unexpectedly succeeded" >&2
    exit 1
  else
    recovery_status=$?
  fi
  [[ "$-" == *e* ]]
  [[ "$recovery_status" == "23" ]]
  [[ ! -s "$RECOVERY_CALLS" ]]
)

# Active and non-active-but-nonterminal migration Jobs both block reclassification and rollback.
for job_state in active unknown; do
  RECOVERY_CALLS="$TEST_DIR/recovery-${job_state}-job.calls"
  export RECOVERY_CALLS job_state
  set +e
  (
    source "$RECOVERY"
    source "$ORCHESTRATOR"
    POSTGRES_RELEASE=opencrane-postgres
    NAMESPACE=opencrane
    kubectl()
    {
      if [[ "$job_state" == "active" ]]; then
        printf '%s\n' '{"kind":"Job","status":{"active":1,"conditions":[]}}'
      else
        printf '%s\n' '{"kind":"Job","status":{"active":0,"conditions":[]}}'
      fi
    }
    classify_live_database_convergence() { printf 'source|%s\n' "$LIVE_ORIGIN" >>"$RECOVERY_CALLS"; }
    helm() { printf 'helm %s\n' "$*" >>"$RECOVERY_CALLS"; }
    log() { :; }
    err() { :; }
    recover_failed_database_transition 23
  )
  recovery_status=$?
  set -e
  [[ "$recovery_status" == "23" ]]
  [[ ! -s "$RECOVERY_CALLS" ]]
done

# A failed rollback also returns the original stage status, never Helm's replacement status.
set +e
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  RELEASE=opencrane
  NAMESPACE=opencrane
  TIMEOUT=37
  DATABASE_PRE_FENCE_RELEASE_REVISION=12
  database_migration_job_is_terminal_or_absent() { return 0; }
  classify_live_database_convergence() { printf 'source|%s\n' "$LIVE_ORIGIN"; }
  helm() { return 47; }
  log() { :; }
  err() { :; }
  recover_failed_database_transition 23
)
rollback_failure_status=$?
set -e
[[ "$rollback_failure_status" == "23" ]]

# External PostgreSQL and SQL-publication failures retain their exact statuses for the recovery
# policy instead of collapsing every failure to status 1.
set +e
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP=baseline
  build_postgres_release_args() { POSTGRES_ARGS=(upgrade); }
  helm() { return 23; }
  log() { :; }
  err() { :; }
  install_postgres_release false true
)
install_failure_status=$?
set -e
[[ "$install_failure_status" == "23" ]]

set +e
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  POSTGRES_MIGRATION_PUBLISHER=/publisher
  NAMESPACE=opencrane
  DATABASE_PREVIOUS_MIGRATION_ID=0.7.0-to-0.8.0
  DATABASE_MIGRATION_SQL_FILE=/migration.sql
  DATABASE_PREVIOUS_MIGRATION_SQL_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  bash() { return 19; }
  err() { :; }
  publish_database_migration_config_map
)
publisher_failure_status=$?
set -e
[[ "$publisher_failure_status" == "19" ]]

set +e
(
  source "$RECOVERY"
  source "$FINALIZATION"
  RELEASE=opencrane
  NAMESPACE=opencrane
  CHART_DIR=/chart
  FROM_RELEASE_VERSION=0.7.0
  RELEASE_VERSION=0.8.0
  TIMEOUT=37
  helm()
  {
    if [[ "$1 $2" == "get values" ]]; then
      printf '%s\n' '{"clustertenantManager":{"replicas":1}}'
      return 0
    fi
    [[ "$1" == "status" ]] && return 0
    return 23
  }
  log() { :; }
  err() { :; }
  fence_existing_opencrane_server
)
fence_failure_status=$?
set -e
[[ "$fence_failure_status" == "23" ]]

# A failed final un-fence restores the exact already-fenced revision and returns the original Helm
# failure even when that restoration succeeds.
FINAL_CALLS="$TEST_DIR/final-transition.calls"
export FINAL_CALLS
set +e
(
  source "$RECOVERY"
  source "$FINALIZATION"
  RELEASE=opencrane
  NAMESPACE=opencrane
  TIMEOUT=37
  DATABASE_FENCED_RELEASE_REVISION=13
  helm()
  {
    printf 'helm %s\n' "$*" >>"$FINAL_CALLS"
    [[ "$1" == "rollback" ]] && return 0
    return 23
  }
  err() { :; }
  run_fenced_finalization_stage helm upgrade --install opencrane /chart
)
final_transition_status=$?
set -e
[[ "$final_transition_status" == "23" ]]
printf '%s\n' \
  'helm upgrade --install opencrane /chart' \
  'helm rollback opencrane 13 --namespace opencrane --wait --timeout 37s --force-conflicts' \
  >"$TEST_DIR/final-transition.expected"
cmp "$TEST_DIR/final-transition.expected" "$FINAL_CALLS"

# Finalization inventory is strict: an API read error is not "Deployment absent", triggers exact
# fenced-revision restoration, and retains the inventory status.
FINAL_CALLS="$TEST_DIR/final-inventory.calls"
export FINAL_CALLS
set +e
(
  source "$RECOVERY"
  source "$FINALIZATION"
  RELEASE=opencrane
  NAMESPACE=opencrane
  TIMEOUT=37
  DATABASE_FENCED_RELEASE_REVISION=13
  kubectl() { return 29; }
  helm() { printf 'helm %s\n' "$*" >>"$FINAL_CALLS"; }
  err() { :; }
  run_opencrane_finalization_stage roll_database_consumers_for_finalization opencrane 37 checksum-value opencrane-server
)
final_inventory_status=$?
set -e
[[ "$final_inventory_status" == "29" ]]
grep -Fxq 'helm rollback opencrane 13 --namespace opencrane --wait --timeout 37s --force-conflicts' "$FINAL_CALLS"

# Reading the fenced revision and post-fence workload inventory also preserve their original status.
set +e
(
  source "$RECOVERY"
  source "$FINALIZATION"
  RELEASE=opencrane
  NAMESPACE=opencrane
  helm() { return 31; }
  err() { :; }
  capture_fenced_main_release_revision
)
fenced_capture_status=$?
set -e
[[ "$fenced_capture_status" == "31" ]]

# A source database without a main Helm release remains supported only when Helm proves the release
# list is empty. There is then no invented rollback revision.
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  RELEASE=opencrane
  NAMESPACE=opencrane
  log() { :; }
  err() { :; }
  helm()
  {
    if [[ "$1" == "status" ]]; then return 1; fi
    printf '%s\n' '[]'
  }
  capture_pre_fence_main_release_revision
  [[ -z "$DATABASE_PRE_FENCE_RELEASE_REVISION" ]]
)

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

# The only privileged path creates the reviewed pg_cron prerequisite while the server remains
# fenced, then restores CNPG's default denial before the ordinary migration finalizes.
PRIVILEGED_CALLS="$TEST_DIR/privileged-extension.calls"
export PRIVILEGED_CALLS
(
  source "$RECOVERY"
  source "$ORCHESTRATOR"
  DATABASE_TRANSITION_KIND=migration
  POSTGRES_CLUSTER_EXISTS=1
  DATABASE_PRIVILEGED_EXTENSION=pg_cron
  POSTGRES_MIGRATION_BACKUP=/privileged-backup.sh
  NAMESPACE=opencrane
  POSTGRES_RELEASE=opencrane-postgres
  TIMEOUT=37
  DATABASE_PRE_FENCE_RELEASE_REVISION=12
  classify_live_database_convergence() { printf 'source|%s\n' "$LIVE_ORIGIN"; }
  capture_pre_fence_main_release_revision() { printf '%s\n' capture >>"$PRIVILEGED_CALLS"; }
  fence_existing_opencrane_server() { printf '%s\n' fence >>"$PRIVILEGED_CALLS"; }
  install_postgres_release()
  {
    printf 'install %s %s super=%s extension=%s temporary=%s\n' "$1" "$2" \
      "${POSTGRES_SUPERUSER_ACCESS_ENABLED:-false}" \
      "${DATABASE_PRIVILEGED_EXTENSION_ENABLED:-false}" \
      "${DATABASE_TEMPORARY_SUPERUSER_ACCESS:-false}" >>"$PRIVILEGED_CALLS"
  }
  verify_database_pg_cron_server_preflight() { printf '%s\n' server-preflight >>"$PRIVILEGED_CALLS"; }
  verify_database_pg_cron_preflight() { printf '%s\n' extension-preflight >>"$PRIVILEGED_CALLS"; }
  verify_database_superuser_access_disabled() { printf '%s\n' superuser-disabled >>"$PRIVILEGED_CALLS"; }
  publish_database_migration_config_map() { printf '%s\n' publish >>"$PRIVILEGED_CALLS"; }
  bash()
  {
    if [[ "$1" == "$POSTGRES_MIGRATION_BACKUP" ]]; then
      printf '%s\n' backup-evidence
      return
    fi
    command bash "$@"
  }
  log() { :; }
  err() { :; }
  run_database_release_transition
)
printf '%s\n' \
  capture \
  fence \
  'install false false super=false extension=false temporary=false' \
  server-preflight \
  publish \
  'install true false super=true extension=true temporary=true' \
  'install false false super=false extension=false temporary=true' \
  superuser-disabled \
  extension-preflight \
  'install false true super=false extension=false temporary=false' \
  >"$TEST_DIR/privileged-extension.expected"
if ! cmp "$TEST_DIR/privileged-extension.expected" "$PRIVILEGED_CALLS"; then
  diff -u "$TEST_DIR/privileged-extension.expected" "$PRIVILEGED_CALLS" >&2 || true
  exit 1
fi

echo "database migration deploy contract: PASS"
