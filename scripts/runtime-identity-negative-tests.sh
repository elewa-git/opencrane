#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"
RELEASE_NAME="${RELEASE_NAME:-opencrane-runtime-contract}"
NAMESPACE="${NAMESPACE:-opencrane-system}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-agent-runtime}"

function _fail()
{
  echo "runtime identity contract failed: $1" >&2
  exit 1
}

function _render_contract()
{
  helm template "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --set agentRuntime.enabled=true
}

function _assert_rendered_contract()
{
  local rendered
  rendered="$(_render_contract)"

  awk -v service_account="$RUNTIME_SERVICE_ACCOUNT" '
    BEGIN { RS = "---"; FS = "\n" }
    {
      kind = 0
      name = 0
      automount_disabled = 0
      for (line_index = 1; line_index <= NF; line_index++)
      {
        if ($line_index ~ /^[[:space:]]*kind:[[:space:]]*ServiceAccount[[:space:]]*$/) kind = 1
        if ($line_index ~ ("^[[:space:]]*name:[[:space:]]*" service_account "[[:space:]]*$")) name = 1
        if ($line_index ~ /^[[:space:]]*automountServiceAccountToken:[[:space:]]*false[[:space:]]*$/) automount_disabled = 1
      }
      if (kind && name && automount_disabled) found = 1
    }
    END { exit found ? 0 : 1 }
  ' <<<"$rendered" || _fail "runtime ServiceAccount is absent or may automount a Kubernetes API token"

  if awk -v namespace="$NAMESPACE" -v service_account="$RUNTIME_SERVICE_ACCOUNT" '
    BEGIN { RS = "---"; FS = "\n" }
    {
      binding = 0
      subject_kind = ""
      for (line_index = 1; line_index <= NF; line_index++)
      {
        if ($line_index ~ /^[[:space:]]*kind:[[:space:]]*(RoleBinding|ClusterRoleBinding)[[:space:]]*$/) binding = 1
        if (!binding) continue
        if ($line_index ~ /^[[:space:]]*kind:[[:space:]]*ServiceAccount[[:space:]]*$/) subject_kind = "ServiceAccount"
        else if ($line_index ~ /^[[:space:]]*kind:[[:space:]]*User[[:space:]]*$/) subject_kind = "User"
        else if ($line_index ~ /^[[:space:]]*kind:[[:space:]]*Group[[:space:]]*$/) subject_kind = "Group"
        else if ($line_index ~ /^[[:space:]]*name:[[:space:]]*/)
        {
          name = $line_index
          sub(/^[[:space:]]*name:[[:space:]]*/, "", name)
          if ((subject_kind == "ServiceAccount" && name == service_account) || (subject_kind == "User" && name == "system:serviceaccount:" namespace ":" service_account) || (subject_kind == "Group" && (name == "system:serviceaccounts" || name == "system:serviceaccounts:" namespace || name == "system:authenticated"))) found = 1
          subject_kind = ""
        }
      }
    }
    END { exit found ? 0 : 1 }
  ' <<<"$rendered"
  then
    _fail "runtime ServiceAccount receives Kubernetes RBAC directly or through an inherited subject group"
  fi

  awk 'BEGIN { RS = "---" } /kind: NetworkPolicy/ && /app\.kubernetes\.io\/component: agent-runtime/ && /ingress: \[\]/ { found = 1 } END { exit found ? 0 : 1 }' <<<"$rendered" || _fail "runtime deny-ingress NetworkPolicy is absent"
}

function _assert_live_rbac_denials()
{
  local subject
  local effective_resource_rules
  subject="system:serviceaccount:${NAMESPACE}:${RUNTIME_SERVICE_ACCOUNT}"

  kubectl get serviceaccount "$RUNTIME_SERVICE_ACCOUNT" --namespace "$NAMESPACE" >/dev/null || _fail "runtime ServiceAccount is not installed"
  effective_resource_rules="$(kubectl auth can-i --list --no-headers --namespace "$NAMESPACE" --as="$subject" | awk '/^[^[:space:]]/')"
  [[ -z "$effective_resource_rules" ]] || _fail "$subject has effective Kubernetes resource permissions: $effective_resource_rules"

  for permission in "create jobs" "get pods" "list pods" "get secrets"
  do
    local verb resource result
    read -r verb resource <<<"$permission"
    result="$(kubectl auth can-i "$verb" "$resource" --namespace "$NAMESPACE" --as="$subject")"
    [[ "$result" == "no" ]] || _fail "$subject unexpectedly may $verb $resource"
  done
}

function _main()
{
  _assert_rendered_contract

  if [[ "${LIVE_CLUSTER:-0}" == "1" ]]
  then
    _assert_live_rbac_denials
  fi

  echo "runtime identity negative checks passed"
}

_main
