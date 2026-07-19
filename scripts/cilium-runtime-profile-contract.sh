#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"
RELEASE_NAME="${RELEASE_NAME:-opencrane-cilium-profiles}"
NAMESPACE="${NAMESPACE:-opencrane-system}"
CONTROLLER_API_CIDR="${CONTROLLER_API_CIDR:-10.96.0.1/32}"

function _fail()
{
  echo "Cilium runtime profile contract failed: $1" >&2
  exit 1
}

function _render_profiles()
{
  helm template "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --set agentRuntime.enabled=true \
    --set agentController.enabled=true \
    --set agentController.runtimeImage=example.invalid/opencrane-agent-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string agentController.kubernetesApi.cidr="$CONTROLLER_API_CIDR" \
    --set networkPolicy.mainNetworkDefaultDeny.enabled=true \
    --set multiInstance.enabled=true \
    --set multiInstance.instanceNamespaces[0]="$NAMESPACE"
}

function _assert_cilium_identity_policy()
{
  local rendered="$1"
  local component="$2"
  local service_account="$3"

  awk -v component="$component" -v service_account="$service_account" '
    BEGIN { RS = "---" }
    /kind: CiliumNetworkPolicy/ && $0 ~ ("app.kubernetes.io/component: " component) {
      if (index($0, "io.cilium.k8s.policy.serviceaccount") && index($0, service_account)) found = 1
    }
    END { exit found ? 0 : 1 }
  ' <<<"$rendered" || _fail "$component CiliumNetworkPolicy does not select ServiceAccount $service_account"
}

function _assert_legacy_umbrellas_exclude_target_profiles()
{
  local rendered="$1"

  awk '
    BEGIN { RS = "---" }
    /name: opencrane-cilium-profiles-platform-default-deny/ && /values: \[artifact-service, agent-controller, agent-runtime, opencrane-server\]/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' <<<"$rendered" || _fail "platform default-deny still widens a target workload profile"

  awk '
    BEGIN { RS = "---" }
    /name: opencrane-cilium-profiles-cross-instance-deny/ && /values: \[artifact-service, agent-controller, agent-runtime, opencrane-server\]/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' <<<"$rendered" || _fail "cross-instance default-deny still widens a target workload profile"
}

function _main()
{
  local rendered
  rendered="$(_render_profiles)"

  _assert_cilium_identity_policy "$rendered" agent-runtime agent-runtime
  _assert_cilium_identity_policy "$rendered" agent-controller "${RELEASE_NAME}-agent-controller"
  _assert_cilium_identity_policy "$rendered" artifact-service "${RELEASE_NAME}-artifact-service"
  _assert_cilium_identity_policy "$rendered" opencrane-server "${RELEASE_NAME}-opencrane-server"
  _assert_legacy_umbrellas_exclude_target_profiles "$rendered"

  echo "Cilium runtime profile contract passed"
}

_main
