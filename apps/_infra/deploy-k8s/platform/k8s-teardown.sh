#!/usr/bin/env bash
# Fail-closed teardown engine for one app-owned standalone silo.
set -euo pipefail

CONTEXT=""
CLUSTER_TENANT=""
CONFIRM_RETIRE=""
EXPECTED_MAIN_CHART=""
EXPECTED_POSTGRES_CHART=""
PREFLIGHT="0"
PROTECTED_CLUSTER_TENANTS=()

log() { printf '\033[0;32m[k8s-teardown]\033[0m %s\n' "$1"; }
err() { printf '\033[0;31m[k8s-teardown]\033[0m %s\n' "$1" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) CONTEXT="$2"; shift 2 ;;
    --cluster-tenant) CLUSTER_TENANT="$2"; shift 2 ;;
    --confirm-retire) CONFIRM_RETIRE="$2"; shift 2 ;;
    --expected-main-chart) EXPECTED_MAIN_CHART="$2"; shift 2 ;;
    --expected-postgres-chart) EXPECTED_POSTGRES_CHART="$2"; shift 2 ;;
    --preflight) PREFLIGHT="1"; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "Unknown flag: $1"; exit 1 ;;
  esac
done

for command_name in kubectl helm jq; do
  command -v "$command_name" >/dev/null 2>&1 || { err "Missing required command: $command_name"; exit 1; }
done

[[ "$CLUSTER_TENANT" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { err "--cluster-tenant must be a DNS label."; exit 1; }
NAMESPACE="opencrane-${CLUSTER_TENANT}"
RELEASE="opencrane-${CLUSTER_TENANT}"
[[ "$CONFIRM_RETIRE" == "$CLUSTER_TENANT" ]] || { err "--confirm-retire must exactly match '$CLUSTER_TENANT'."; exit 1; }
[[ "$EXPECTED_MAIN_CHART" =~ ^opencrane-silo-[0-9]+\.[0-9]+\.[0-9]+$ ]] || { err "--expected-main-chart is invalid."; exit 1; }
[[ "$EXPECTED_POSTGRES_CHART" =~ ^postgres-[0-9]+\.[0-9]+\.[0-9]+$ ]] || { err "--expected-postgres-chart is invalid."; exit 1; }
[[ -n "$CONTEXT" ]] || { err "--context is required."; exit 1; }
CURRENT_CONTEXT="$(kubectl config current-context)"
[[ "$CURRENT_CONTEXT" == "$CONTEXT" ]] || { err "kubectl context mismatch: expected '$CONTEXT', got '$CURRENT_CONTEXT'."; exit 1; }

# Destructive callers do not get to declare which live tenant is protected. That authority is a
# reviewed repository-owned registry, keyed by the exact Kubernetes context already proven above.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTECTED_TENANTS_FILE="$SCRIPT_DIR/../protected-cluster-tenants.json"
[[ -f "$PROTECTED_TENANTS_FILE" ]] || { err "Protected-tenant registry is missing."; exit 1; }
PROTECTED_TENANT_LINES="$(
  jq -er --arg context "$CONTEXT" '.contexts[$context].protectedClusterTenants[]' "$PROTECTED_TENANTS_FILE"
)" || { err "No reviewed protected-tenant registry entry exists for context '$CONTEXT'."; exit 1; }
while IFS= read -r protected_cluster_tenant; do
  PROTECTED_CLUSTER_TENANTS+=("$protected_cluster_tenant")
done <<<"$PROTECTED_TENANT_LINES"
[[ "${#PROTECTED_CLUSTER_TENANTS[@]}" -gt 0 ]] || {
  err "Context '$CONTEXT' has no protected ClusterTenant entries."
  exit 1
}
for protected_cluster_tenant in "${PROTECTED_CLUSTER_TENANTS[@]}"; do
  if [[ "$CLUSTER_TENANT" == "$protected_cluster_tenant" ]]; then
    err "Protected active tenant '$protected_cluster_tenant' cannot be retired by this workflow."
    exit 1
  fi
done

POSTGRES_RELEASE="${RELEASE}-postgres"
MAIN_RELEASE_EXISTS="0"
POSTGRES_RELEASE_EXISTS="0"
NAMESPACE_EXISTS="0"
CNPG_CLUSTER_EXISTS="0"

release_chart()
{
  local releases
  if ! releases="$(helm list --kube-context "$CONTEXT" --namespace "$NAMESPACE" --filter "^$1$" --output json)"; then
    err "Unable to read Helm release '$1' in '$NAMESPACE'."
    exit 1
  fi
  jq -r --arg release "$1" '.[] | select(.name == $release) | .chart' <<<"$releases"
}

assert_release_owner()
{
  local release_name="$1"
  local expected_chart="$2"
  local chart
  chart="$(release_chart "$release_name")"
  [[ -z "$chart" ]] && return 1
  [[ "$chart" == "$expected_chart" ]] || {
    err "Foreign Helm ownership: release '$release_name' uses chart '$chart', expected '$expected_chart'."
    exit 1
  }
  return 0
}

resource_exists()
{
  local resource_kind="$1"
  local resource_name="$2"
  local resource_namespace="${3:-}"
  local args=(--context "$CONTEXT" get "$resource_kind/$resource_name" --ignore-not-found -o name)
  [[ -z "$resource_namespace" ]] || args+=(--namespace "$resource_namespace")
  local result
  if ! result="$(kubectl "${args[@]}" 2>&1)"; then
    err "Unable to prove whether $resource_kind/$resource_name exists: $result"
    exit 1
  fi
  [[ -n "$result" ]]
}

if resource_exists namespace "$NAMESPACE"; then
  NAMESPACE_EXISTS="1"
fi
if assert_release_owner "$RELEASE" "$EXPECTED_MAIN_CHART"; then
  MAIN_RELEASE_EXISTS="1"
fi
if assert_release_owner "$POSTGRES_RELEASE" "$EXPECTED_POSTGRES_CHART"; then
  POSTGRES_RELEASE_EXISTS="1"
fi

# A namespace may not contain an unrelated Helm release. This check also makes a retry safe:
# zero releases, or only whichever target release remains after a partial run, are accepted.
if [[ "$NAMESPACE_EXISTS" == "1" ]]; then
  if ! MAIN_RELEASE_INVENTORY="$(helm list --kube-context "$CONTEXT" --namespace "$NAMESPACE" --output json)"; then
    err "Unable to inventory Helm releases in '$NAMESPACE'."
    exit 1
  fi
  FOREIGN_RELEASES="$(jq -r --arg app "$RELEASE" --arg postgres "$POSTGRES_RELEASE" \
    '.[] | select(.name != $app and .name != $postgres) | .name' <<<"$MAIN_RELEASE_INVENTORY")"
  [[ -z "$FOREIGN_RELEASES" ]] || { err "Foreign Helm releases exist in '$NAMESPACE': $FOREIGN_RELEASES"; exit 1; }
fi

assert_cnpg_owner_if_present()
{
  local resource_kind="$1"
  local resource_name="$2"
  local instance
  local managed_by
  if ! resource_exists "$resource_kind" "$resource_name" "$NAMESPACE"; then
    return
  fi
  instance="$(kubectl --context "$CONTEXT" get "$resource_kind/$resource_name" --namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/instance}')"
  managed_by="$(kubectl --context "$CONTEXT" get "$resource_kind/$resource_name" --namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  [[ "$instance" == "$POSTGRES_RELEASE" && "$managed_by" == "Helm" ]] || {
    err "Foreign ownership on $resource_kind/$resource_name; expected Helm instance '$POSTGRES_RELEASE'."
    exit 1
  }
}

if resource_exists cluster "$POSTGRES_RELEASE" "$NAMESPACE"; then
  CNPG_CLUSTER_EXISTS="1"
fi
assert_cnpg_owner_if_present cluster "$POSTGRES_RELEASE"
assert_cnpg_owner_if_present database "${POSTGRES_RELEASE}-litellm"

EXPECTED_AUX_NAMESPACES=(
  "${RELEASE}-artifacts"
  "${RELEASE}-runtime"
  "${RELEASE}-managed-runtime"
  "${RELEASE}-artifact-preprocessing"
  "${RELEASE}-skill-authoring"
  "${RELEASE}-mcp-executors"
)
RETIREMENT_OWNER_LABEL="opencrane.ai/retirement-owner"
OWNED_AUX_NAMESPACES=()

if [[ "$NAMESPACE_EXISTS" == "1" ]]; then
  MAIN_RETIREMENT_OWNER="$(kubectl --context "$CONTEXT" get namespace "$NAMESPACE" -o "jsonpath={.metadata.labels.opencrane\\.ai/retirement-owner}" 2>/dev/null || true)"
  if [[ "$MAIN_RETIREMENT_OWNER" != "$RELEASE" && "$MAIN_RELEASE_EXISTS" != "1" \
    && "$POSTGRES_RELEASE_EXISTS" != "1" && "$CNPG_CLUSTER_EXISTS" != "1" ]]; then
    err "Cannot prove namespace '$NAMESPACE' belongs to '$RELEASE'; no owned release, CNPG cluster, or retirement marker remains."
    exit 1
  fi
fi

assert_auxiliary_namespace_owner()
{
  local auxiliary_namespace="$1"
  local sentinel_kind="$2"
  local sentinel_name="$3"
  local label_key="$4"
  local expected_label="$5"
  local retirement_owner
  local sentinel_label
  local sentinel_managed_by
  local sentinel_release_name
  local sentinel_release_namespace
  retirement_owner="$(kubectl --context "$CONTEXT" get namespace "$auxiliary_namespace" -o "jsonpath={.metadata.labels.opencrane\\.ai/retirement-owner}" 2>/dev/null || true)"
  if [[ "$retirement_owner" == "$RELEASE" ]]; then
    return
  fi
  # An interrupted install can create the artifact namespace and both keys before Helm records the main release.
  # When the PostgreSQL release and cluster remain, those keys prove its owner for recovery teardown.
  if [[ "$auxiliary_namespace" == "${RELEASE}-artifacts" && "$MAIN_RELEASE_EXISTS" == "0" \
    && "$POSTGRES_RELEASE_EXISTS" == "1" && "$CNPG_CLUSTER_EXISTS" == "1" ]]; then
    local catalog_key
    local service_key
    catalog_key="$(kubectl --context "$CONTEXT" get secret "${RELEASE}-artifact-catalog-keys" --namespace "$NAMESPACE" -o 'jsonpath={.data.lease-private\.pem}' 2>/dev/null || true)"
    service_key="$(kubectl --context "$CONTEXT" get secret "${RELEASE}-artifact-service-keys" --namespace "$auxiliary_namespace" -o 'jsonpath={.data.receipt-private\.pem}' 2>/dev/null || true)"
    [[ -n "$catalog_key" && -n "$service_key" ]] || {
      err "Cannot prove interrupted artifact namespace '$auxiliary_namespace' belongs to '$RELEASE'; its two deploy-created key Secrets are incomplete."
      exit 1
    }
    return
  fi
  [[ "$MAIN_RELEASE_EXISTS" == "1" ]] || {
    err "Cannot prove auxiliary namespace '$auxiliary_namespace' belongs to '$RELEASE'; its release and retirement marker are absent."
    exit 1
  }
  sentinel_label="$(kubectl --context "$CONTEXT" get "$sentinel_kind/$sentinel_name" --namespace "$auxiliary_namespace" -o "jsonpath={.metadata.labels.${label_key}}" 2>/dev/null || true)"
  sentinel_managed_by="$(kubectl --context "$CONTEXT" get "$sentinel_kind/$sentinel_name" --namespace "$auxiliary_namespace" -o 'jsonpath={.metadata.labels.app\.kubernetes\.io/managed-by}' 2>/dev/null || true)"
  sentinel_release_name="$(kubectl --context "$CONTEXT" get "$sentinel_kind/$sentinel_name" --namespace "$auxiliary_namespace" -o 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null || true)"
  sentinel_release_namespace="$(kubectl --context "$CONTEXT" get "$sentinel_kind/$sentinel_name" --namespace "$auxiliary_namespace" -o 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-namespace}' 2>/dev/null || true)"
  [[ "$sentinel_label" == "$expected_label" && "$sentinel_managed_by" == "Helm" \
    && "$sentinel_release_name" == "$RELEASE" && "$sentinel_release_namespace" == "$NAMESPACE" ]] || {
    err "Foreign ownership on auxiliary namespace '$auxiliary_namespace'; its sentinel is not owned by Helm release '$RELEASE' in '$NAMESPACE'."
    exit 1
  }
}

for auxiliary_namespace in "${EXPECTED_AUX_NAMESPACES[@]}"; do
  for protected_cluster_tenant in "${PROTECTED_CLUSTER_TENANTS[@]}"; do
    [[ "$auxiliary_namespace" != "opencrane-${protected_cluster_tenant}"* ]] || {
      err "Protected namespace '$auxiliary_namespace' entered the target inventory."
      exit 1
    }
  done
  if resource_exists namespace "$auxiliary_namespace"; then
    if ! AUX_RELEASES="$(helm list --kube-context "$CONTEXT" --namespace "$auxiliary_namespace" --output json)"; then
      err "Unable to inventory Helm releases in auxiliary namespace '$auxiliary_namespace'."
      exit 1
    fi
    [[ "$(jq 'length' <<<"$AUX_RELEASES")" == "0" ]] || {
      err "Auxiliary namespace '$auxiliary_namespace' contains a Helm release; ownership is not delegated to this teardown."
      exit 1
    }
    case "$auxiliary_namespace" in
      "${RELEASE}-artifacts")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" deployment "${RELEASE}-artifact-service" 'app\.kubernetes\.io/instance' "$RELEASE" ;;
      "${RELEASE}-runtime")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" serviceaccount warm-runtime 'app\.kubernetes\.io/component' warm-runtime ;;
      "${RELEASE}-managed-runtime")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" serviceaccount warm-runtime 'app\.kubernetes\.io/component' warm-runtime ;;
      "${RELEASE}-artifact-preprocessing")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" deployment "${RELEASE}-artifact-preprocessor" 'app\.kubernetes\.io/instance' "$RELEASE" ;;
      "${RELEASE}-skill-authoring")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" serviceaccount skill-authoring-default 'app\.kubernetes\.io/component' skill-authoring ;;
      "${RELEASE}-mcp-executors")
        assert_auxiliary_namespace_owner "$auxiliary_namespace" serviceaccount mcp-executor-default 'app\.kubernetes\.io/component' mcp-executor ;;
    esac
    OWNED_AUX_NAMESPACES+=("$auxiliary_namespace")
  fi
done

EXPECTED_RBAC_NAMES=(
  "${RELEASE}-opencrane-server-tokenreview-${NAMESPACE}"
  "${RELEASE}-opencrane-server-ct-read-${NAMESPACE}"
  "${RELEASE}-memory-gateway-tokenreview-${NAMESPACE}"
)
assert_cluster_rbac_owner_if_present()
{
  local resource_kind="$1"
  local resource_name="$2"
  local managed_by
  local release_name
  local release_namespace
  if ! resource_exists "$resource_kind" "$resource_name"; then
    return
  fi
  managed_by="$(kubectl --context "$CONTEXT" get "$resource_kind/$resource_name" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  release_name="$(kubectl --context "$CONTEXT" get "$resource_kind/$resource_name" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}')"
  release_namespace="$(kubectl --context "$CONTEXT" get "$resource_kind/$resource_name" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-namespace}')"
  [[ "$managed_by" == "Helm" && "$release_name" == "$RELEASE" && "$release_namespace" == "$NAMESPACE" ]] || {
    err "Foreign ownership on $resource_kind/$resource_name; refusing cluster-scoped deletion."
    exit 1
  }
}
for rbac_name in "${EXPECTED_RBAC_NAMES[@]}"; do
  assert_cluster_rbac_owner_if_present clusterrole "$rbac_name"
  assert_cluster_rbac_owner_if_present clusterrolebinding "$rbac_name"
done

log "Inventory accepted: tenant='$CLUSTER_TENANT' namespace='$NAMESPACE' release='$RELEASE' postgres='$POSTGRES_RELEASE'."
if [[ "$PREFLIGHT" == "1" ]]; then
  log "Preflight complete; no Kubernetes resources changed."
  exit 0
fi

# Persist the already-proven auxiliary ownership before Helm removes its sentinels. A retry can
# then distinguish a half-retired namespace from a foreign namespace with a colliding name.
if [[ "$NAMESPACE_EXISTS" == "1" ]]; then
  kubectl --context "$CONTEXT" label namespace "$NAMESPACE" "$RETIREMENT_OWNER_LABEL=$RELEASE" --overwrite
fi
for auxiliary_namespace in "${OWNED_AUX_NAMESPACES[@]-}"; do
  [[ -z "$auxiliary_namespace" ]] || kubectl --context "$CONTEXT" label namespace "$auxiliary_namespace" \
    "$RETIREMENT_OWNER_LABEL=$RELEASE" --overwrite
done

[[ "$MAIN_RELEASE_EXISTS" == "0" ]] || helm uninstall "$RELEASE" --kube-context "$CONTEXT" --namespace "$NAMESPACE" --wait
[[ "$POSTGRES_RELEASE_EXISTS" == "0" ]] || helm uninstall "$POSTGRES_RELEASE" --kube-context "$CONTEXT" --namespace "$NAMESPACE" --wait

# The PostgreSQL chart intentionally marks these resources keep. Delete only the exact names
# already proven to carry this PostgreSQL release's Helm ownership labels.
for database_name in "${POSTGRES_RELEASE}-litellm"; do
  if resource_exists database "$database_name" "$NAMESPACE"; then
    assert_cnpg_owner_if_present database "$database_name"
    kubectl --context "$CONTEXT" delete "database/$database_name" --namespace "$NAMESPACE" --wait=true
  fi
done
if resource_exists cluster "$POSTGRES_RELEASE" "$NAMESPACE"; then
  assert_cnpg_owner_if_present cluster "$POSTGRES_RELEASE"
  kubectl --context "$CONTEXT" delete "cluster/$POSTGRES_RELEASE" --namespace "$NAMESPACE" --wait=true
fi

# CNPG creates data PVCs outside Helm. Both labels are required so no application or other
# tenant volume can match this deletion selector.
kubectl --context "$CONTEXT" delete pvc --namespace "$NAMESPACE" \
  --selector "app.kubernetes.io/instance=${POSTGRES_RELEASE},cnpg.io/cluster=${POSTGRES_RELEASE}" \
  --ignore-not-found=true --wait=true

# Helm normally removes these RBAC objects. Exact names plus the tenant namespace suffix make
# this an idempotent cleanup for interrupted uninstalls without admitting wildcard deletion.
for rbac_name in "${EXPECTED_RBAC_NAMES[@]}"; do
  assert_cluster_rbac_owner_if_present clusterrole "$rbac_name"
  assert_cluster_rbac_owner_if_present clusterrolebinding "$rbac_name"
  kubectl --context "$CONTEXT" delete clusterrole "$rbac_name" --ignore-not-found=true --wait=true
  kubectl --context "$CONTEXT" delete clusterrolebinding "$rbac_name" --ignore-not-found=true --wait=true
done

for auxiliary_namespace in "${OWNED_AUX_NAMESPACES[@]-}"; do
  [[ -n "$auxiliary_namespace" ]] || continue
  kubectl --context "$CONTEXT" delete namespace "$auxiliary_namespace" --ignore-not-found=true --wait=true
done
if [[ "$NAMESPACE_EXISTS" == "1" ]]; then
  kubectl --context "$CONTEXT" delete namespace "$NAMESPACE" --ignore-not-found=true --wait=true
fi

log "Retired ClusterTenant '$CLUSTER_TENANT'. Shared controllers, CRDs, ingress, cert-manager, and CloudNativePG were not targeted."
