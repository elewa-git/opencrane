#!/usr/bin/env bash
# Retire exactly one standalone ClusterTenant silo. External identity and DNS changes are
# deliberately acknowledgements, not inferred side effects of deleting Kubernetes resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/platform/k8s-teardown.sh"

CONTEXT=""
CLUSTER_TENANT=""
BASE_DOMAIN=""
RELEASE_VERSION=""
CONFIRM_RETIRE=""
CONFIRM_DNS_RETIRED=""
CONFIRM_ZITADEL_RETIRED=""
PREFLIGHT="0"

err() { printf '\033[0;31m[silo-teardown]\033[0m %s\n' "$1" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) CONTEXT="$2"; shift 2 ;;
    --cluster-tenant) CLUSTER_TENANT="$2"; shift 2 ;;
    --base-domain) BASE_DOMAIN="$2"; shift 2 ;;
    --release-version) RELEASE_VERSION="$2"; shift 2 ;;
    --confirm-retire) CONFIRM_RETIRE="$2"; shift 2 ;;
    --confirm-dns-retired) CONFIRM_DNS_RETIRED="$2"; shift 2 ;;
    --confirm-zitadel-retired) CONFIRM_ZITADEL_RETIRED="$2"; shift 2 ;;
    --preflight) PREFLIGHT="1"; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "Unknown flag: $1"; exit 1 ;;
  esac
done

[[ -n "$CONTEXT" ]] || { err "--context is required; teardown never trusts the current context implicitly."; exit 1; }
[[ -n "$CLUSTER_TENANT" ]] || { err "--cluster-tenant is required."; exit 1; }
[[ -n "$BASE_DOMAIN" ]] || { err "--base-domain is required so external retirement evidence can be checked exactly."; exit 1; }
[[ "$RELEASE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  err "--release-version must be the exact repository semantic version installed in this silo."
  exit 1
}
[[ "$BASE_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || {
  err "--base-domain must be a lowercase FQDN with no scheme, path, port, or trailing dot."
  exit 1
}

EXPECTED_HOST="${CLUSTER_TENANT}.${BASE_DOMAIN}"
EXPECTED_CALLBACK="https://${EXPECTED_HOST}/api/v1/auth/callback"

for command_name in jq kubectl; do
  command -v "$command_name" >/dev/null 2>&1 || { err "Missing required command: $command_name"; exit 1; }
done
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CURRENT_CONTEXT="$(kubectl config current-context)"
[[ "$CURRENT_CONTEXT" == "$CONTEXT" ]] || { err "kubectl context mismatch: expected '$CONTEXT', got '$CURRENT_CONTEXT'."; exit 1; }
PROTECTED_TENANTS_FILE="$SCRIPT_DIR/protected-cluster-tenants.json"
[[ -f "$PROTECTED_TENANTS_FILE" ]] || { err "Protected-tenant registry is missing."; exit 1; }
PROTECTED_TENANT_LINES="$(
  jq -er --arg context "$CONTEXT" '.contexts[$context].protectedClusterTenants[]' "$PROTECTED_TENANTS_FILE"
)" || { err "No reviewed protected-tenant registry entry exists for context '$CONTEXT'."; exit 1; }
while IFS= read -r protected_cluster_tenant; do
  if [[ "$CLUSTER_TENANT" == "$protected_cluster_tenant" ]]; then
    err "Protected active tenant '$protected_cluster_tenant' cannot be retired by this workflow."
    exit 1
  fi
done <<<"$PROTECTED_TENANT_LINES"
RELEASE_MANIFEST="$REPOSITORY_ROOT/releases/${RELEASE_VERSION}.json"
[[ -f "$RELEASE_MANIFEST" ]] || { err "Release manifest '$RELEASE_MANIFEST' does not exist."; exit 1; }
[[ "$(jq -r '.repositoryVersion' "$RELEASE_MANIFEST")" == "$RELEASE_VERSION" ]] || {
  err "Release manifest does not bind repository version '$RELEASE_VERSION'."
  exit 1
}
MAIN_CHART_VERSION="$(jq -er '.projects["deploy-k8s"].chartVersion' "$RELEASE_MANIFEST")" || {
  err "Release manifest has no deploy-k8s chart version."
  exit 1
}
POSTGRES_CHART_VERSION="$(jq -er '.projects.postgres.chartVersion' "$RELEASE_MANIFEST")" || {
  err "Release manifest has no postgres chart version."
  exit 1
}
[[ "$CONFIRM_RETIRE" == "$CLUSTER_TENANT" ]] || { err "Refusing teardown: pass --confirm-retire '$CLUSTER_TENANT' exactly."; exit 1; }
[[ "$CONFIRM_DNS_RETIRED" == "$EXPECTED_HOST" ]] || {
  err "REMAINING EXTERNAL ACTION: retire DNS host '$EXPECTED_HOST', then pass --confirm-dns-retired '$EXPECTED_HOST'."
  exit 1
}
[[ "$CONFIRM_ZITADEL_RETIRED" == "$EXPECTED_CALLBACK" ]] || {
  err "REMAINING EXTERNAL ACTION: remove Zitadel callback '$EXPECTED_CALLBACK' and its matching origin/logout URL, then pass --confirm-zitadel-retired '$EXPECTED_CALLBACK'."
  exit 1
}

ARGS=(
  --context "$CONTEXT"
  --cluster-tenant "$CLUSTER_TENANT"
  --expected-main-chart "opencrane-silo-${MAIN_CHART_VERSION}"
  --expected-postgres-chart "postgres-${POSTGRES_CHART_VERSION}"
  --confirm-retire "$CONFIRM_RETIRE"
)
[[ "$PREFLIGHT" == "0" ]] || ARGS+=(--preflight)
exec "$CORE" "${ARGS[@]}"
