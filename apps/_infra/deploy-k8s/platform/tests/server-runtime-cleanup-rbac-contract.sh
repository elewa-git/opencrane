#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

rendered="$(helm template opencrane-silo "$CHART_DIR")"
ct_read_role="$(printf '%s\n' "$rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: ClusterRole\n/ && $0 ~ /\n  name: opencrane-silo-opencrane-server-ct-read-default\n/ { print $0 }
')"
ct_read_binding="$(printf '%s\n' "$rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: ClusterRoleBinding\n/ && $0 ~ /\n  name: opencrane-silo-opencrane-server-ct-read-default\n/ { print $0 }
')"
cleanup_rbac="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if ((is_role || is_binding) && is_cleanup_name) {
      printf "%s---\n", document
    }
    document = ""
    is_role = 0
    is_binding = 0
    is_cleanup_name = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: Role$/ {
    is_role = 1
  }
  /^kind: RoleBinding$/ {
    is_binding = 1
  }
  /^  name: opencrane-silo-runtime-cleanup$/ {
    is_cleanup_name = 1
  }
  END {
    flush_document()
  }
')"

[[ "$(grep -xc 'kind: ClusterRole' <<<"$ct_read_role")" -eq 1 ]]
grep -Fq '    resources: ["clustertenants"]' <<<"$ct_read_role"
if grep -Fq 'subjects:' <<<"$ct_read_role"; then
  echo "ClusterTenant reader ClusterRole contains binding subjects" >&2
  exit 1
fi
[[ "$(grep -xc 'kind: ClusterRoleBinding' <<<"$ct_read_binding")" -eq 1 ]]
grep -Fq '  kind: ClusterRole' <<<"$ct_read_binding"
if [[ "$(grep -Fc '  name: opencrane-silo-opencrane-server-ct-read-default' <<<"$ct_read_binding")" -ne 2 ]]; then
  echo "ClusterTenant reader binding does not reference its exact ClusterRole" >&2
  exit 1
fi
grep -Fq '    name: opencrane-silo-opencrane-server' <<<"$ct_read_binding"
grep -Fq '    namespace: default' <<<"$ct_read_binding"

[[ -z "$cleanup_rbac" ]]

test_digest="sha256:$(printf 'a%.0s' {1..64})"
enabled_rendered="$(helm template opencrane-silo "$CHART_DIR" \
  --set agentController.enabled=true \
  --set-string agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32 \
  --set-string agentController.image.digest="$test_digest" \
  --set-string agentController.runtimeProfile.image.digest="$test_digest" \
  --set-string agentController.skillWorkloadProfiles.authoring.image.digest="$test_digest" \
  --set-string agentController.skillWorkloadProfiles.toolRunner.image.digest="$test_digest")"
enabled_cleanup_rbac="$(printf '%s\n' "$enabled_rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: Role(Binding)?\n/ && $0 ~ /\n  name: opencrane-silo-runtime-cleanup\n/ { print $0 "---" }
')"
if [[ "$(grep -xc 'kind: Role' <<<"$enabled_cleanup_rbac")" -ne 2 \
  || "$(grep -xc 'kind: RoleBinding' <<<"$enabled_cleanup_rbac")" -ne 2 ]]; then
  echo "enabled runtime cleanup RBAC must have one Role and RoleBinding per runtime namespace" >&2
  exit 1
fi
grep -Fq '  namespace: opencrane-silo-runtime' <<<"$enabled_cleanup_rbac"
grep -Fq '  namespace: opencrane-silo-managed-runtime' <<<"$enabled_cleanup_rbac"
[[ "$(grep -Fc '    resources: ["jobs"]' <<<"$enabled_cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '    verbs: ["get", "delete"]' <<<"$enabled_cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '  name: opencrane-silo-opencrane-server' <<<"$enabled_cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '    namespace: default' <<<"$enabled_cleanup_rbac")" -eq 2 ]]

if grep -Eq 'verbs:.*(create|patch|update|list|watch)|resources:.*(pods|secrets|deployments)' <<<"$enabled_cleanup_rbac"; then
  echo "opencrane-server runtime cleanup RBAC exceeds exact Job get/delete authority" >&2
  exit 1
fi

echo "opencrane-server runtime cleanup RBAC contract: PASS"
