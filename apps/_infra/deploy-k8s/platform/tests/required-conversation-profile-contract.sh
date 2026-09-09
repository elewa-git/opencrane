#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/required-conversation-profile.sh"
TEST_DIRECTORY="$(mktemp -d)"
trap 'cleanup_current_chart_sources; rm -rf -- "$TEST_DIRECTORY"' EXIT
REAL_HELM="$(command -v helm)"
export REAL_HELM TEST_DIRECTORY
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"
RELEASE=opencrane-acme
NAMESPACE=opencrane-acme
DIGEST="sha256:$(printf '%064d' 1)"
cat >"$TEST_DIRECTORY/complete.yaml" <<VALUES
historyStore:
  kurrentdb:
    enabled: true
    image:
      digest: $DIGEST
    tls:
      existingSecret: ledger-tls
    bootstrapAdmin:
      existingSecret: ledger-admin
    bootstrapOps:
      existingSecret: ledger-ops
    serviceCredential:
      existingSecret: ledger-service
    bootstrap:
      image:
        repository: registry.example/bootstrap
        digest: $DIGEST
agentSandbox:
  enabled: true
  namespace: opencrane-acme
  runtimeClassName: approved-runc
  serviceAccountName: conversation-sandbox
  profiles:
    - name: developer
      poolName: developer-pool
      warmReplicas: 0
      image:
        repository: registry.example/computer
        digest: $DIGEST
        pullPolicy: IfNotPresent
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
VALUES
printf 'historyStore:\n  kurrentdb:\n    enabled: false\n' >"$TEST_DIRECTORY/disabled.yaml"
printf 'false' >"$TEST_DIRECTORY/disabled.txt"

err() { printf '%s\n' "$*" >&2; }
# Exercise the real Helm templates without requiring a cluster. Record preservation flags as
# arguments; their release-merging implementation remains Helm's responsibility in production.
helm()
{
  local verb="$1" release chart argument mode="" dry_run=0
  local render_args=()
  shift
  case "$verb" in
    dependency) "$REAL_HELM" dependency "$@" ;;
    status) [[ "${TEST_RELEASE_EXISTS:-0}" == 1 ]] ;;
    get) printf '{}\n' ;;
    upgrade)
      [[ "$1" == --install ]] || return 99
      release="$2"
      chart="$3"
      shift 3
      while (( $# > 0 )); do
        argument="$1"
        shift
        case "$argument" in
          --dry-run=server) dry_run=1 ;;
          --hide-secret|--no-hooks|--disable-openapi-validation) ;;
          --reuse-values|--reset-values|--reset-then-reuse-values) mode="$argument" ;;
          *) render_args+=("$argument") ;;
        esac
      done
      if [[ "$dry_run" != 1 ]]; then
        printf 'MUTATION helm upgrade\n' >>"$TEST_DIRECTORY/calls"
        return 99
      fi
      printf 'validate %s\n' "$mode" >>"$TEST_DIRECTORY/calls"
      "$REAL_HELM" template "$release" "$chart" --kube-version 1.35.0 "${render_args[@]}"
      ;;
    *) printf 'Unexpected Helm call: %s\n' "$verb" >&2; return 99 ;;
  esac
}
export -f helm
expect_rejected()
{
  if require_conversation_deployment_profile "$@" >"$TEST_DIRECTORY/rejected" 2>&1; then
    printf 'Invalid conversation deployment inputs were accepted.\n' >&2
    exit 1
  fi
}

require_conversation_deployment_profile --values "$TEST_DIRECTORY/complete.yaml" || exit 1
expect_rejected
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set historyStore.kurrentdb.enabled=false
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set agentSandbox.enabled=false
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string agentSandbox.enabled=false
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string historyStore.kurrentdb.image.digest=
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string historyStore.kurrentdb.tls.existingSecret=
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string historyStore.kurrentdb.bootstrap.image.digest=
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-json 'agentSandbox.profiles=[]'
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string 'agentSandbox.profiles[0].image.digest='
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --values "$TEST_DIRECTORY/disabled.yaml"
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-literal historyStore.kurrentdb.enabled=false
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-file "historyStore.kurrentdb.enabled=$TEST_DIRECTORY/disabled.txt"
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-json 'historyStore.kurrentdb.enabled=false'
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set historyStore.kurrentdb.enabled=false --set-json 'historyStore.kurrentdb.enabled=true'
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --skip-schema-validation
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --namespace another-silo
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --post-renderer arbitrary-command
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --dry-run=none
require_conversation_deployment_profile --values "$TEST_DIRECTORY/disabled.yaml" --values "$TEST_DIRECTORY/complete.yaml" || exit 1
require_conversation_deployment_profile --values "$TEST_DIRECTORY/complete.yaml" --reset-values || exit 1
require_conversation_deployment_profile --values "$TEST_DIRECTORY/complete.yaml" --reuse-values || exit 1
require_conversation_deployment_profile --values "$TEST_DIRECTORY/complete.yaml" --reset-then-reuse-values || exit 1
for mode in --reset-values --reuse-values --reset-then-reuse-values; do
  grep -Fq -- "validate $mode" "$TEST_DIRECTORY/calls" || exit 1
done

# Invalid schema input can appear in Helm diagnostics. The deployment prints a fixed diagnostic.
expect_rejected --values "$TEST_DIRECTORY/complete.yaml" --set-string 'agentSandbox.profiles[0].image.digest=private-test-marker'
if grep -Fq private-test-marker "$TEST_DIRECTORY/rejected"; then
  printf 'Helm validation exposed a supplied value.\n' >&2
  exit 1
fi

kubectl()
{
  printf 'kubectl %s\n' "$*" >>"$TEST_DIRECTORY/calls"
  case "$1" in
    cluster-info) return 0 ;;
    config) printf 'contract-cluster\n'; return 0 ;;
    get) ;;
    *) printf 'MUTATION kubectl\n' >>"$TEST_DIRECTORY/calls"; return 99 ;;
  esac
  case "$*" in
    *"service kubernetes"*"clusterIP"*) printf '10.43.0.1' ;;
    *"service kubernetes"*"port"*) printf '443' ;;
    *"endpoints kubernetes"*"ports"*) printf '6443' ;;
    *"endpoints kubernetes"*"addresses"*) printf '172.18.0.2\n' ;;
    *storageclass*) printf 'true' ;;
    *"get ds"*) printf 'daemonset.apps/cilium\n' ;;
    *"get secret"*".type"*) printf 'kubernetes.io/basic-auth' ;;
    *"get secret opencrane-bootstrap"*".data.username"*) printf opencrane | base64 ;;
    *"get secret litellm-bootstrap"*".data.username"*) printf litellm | base64 ;;
    *"get secret admin-bootstrap"*".data.username"*) printf opencrane_database_admin | base64 ;;
    *"get secret"*".data.password"*) printf contract-password | base64 ;;
  esac
}
skopeo() { printf 'sha256:%064d\n' 1; }
export -f kubectl skopeo
CORE_ARGS=(--cluster-tenant acme --release opencrane-acme --namespace opencrane-acme
  --release-version "$(jq -r .version "$ROOT_DIR/package.json")"
  --image-tag sha-1234567 --opencrane-ui-digest "$DIGEST" --cognee-digest "$DIGEST"
  --postgres-credentials-secret opencrane-bootstrap
  --litellm-postgres-credentials-secret litellm-bootstrap
  --postgres-admin-credentials-secret admin-bootstrap)
export OPENCRANE_CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"
bash "$CORE" "${CORE_ARGS[@]}" --values "$TEST_DIRECTORY/complete.yaml" --preflight >"$TEST_DIRECTORY/core-output" 2>&1 || { cat "$TEST_DIRECTORY/core-output" >&2; exit 1; }
# This proves an arbitrary silo and an approved non-gvisor profile can pass direct-core preflight.
grep -Fq 'Preflight: all checks passed.' "$TEST_DIRECTORY/core-output" || exit 1
for action in --preflight install; do
  action_args=("${CORE_ARGS[@]}")
  [[ "$action" == install ]] || action_args+=("$action")
  for input in missing disabled raw-disabled; do
    input_args=(--storage-class contract-storage)
    case "$input" in
      disabled) input_args=(--values "$TEST_DIRECTORY/complete.yaml" --set historyStore.kurrentdb.enabled=false) ;;
      raw-disabled) input_args=(--values "$TEST_DIRECTORY/complete.yaml" --helm-arg --set-json --helm-arg 'agentSandbox.enabled=false') ;;
    esac
    if bash "$CORE" "${action_args[@]}" "${input_args[@]}" >"$TEST_DIRECTORY/core-output" 2>&1; then
      printf 'Direct core accepted %s inputs during %s.\n' "$input" "$action" >&2
      exit 1
    fi
    grep -Fq 'Conversation deployment inputs failed Helm validation' "$TEST_DIRECTORY/core-output" || exit 1
  done
done
if grep -Fq MUTATION "$TEST_DIRECTORY/calls"; then
  printf 'Conversation preflight or invalid inputs reached a cluster mutation.\n' >&2
  exit 1
fi
printf 'required conversation profile contract: PASS\n'
