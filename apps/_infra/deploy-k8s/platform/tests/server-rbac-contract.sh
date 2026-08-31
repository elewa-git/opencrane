#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}")"
ct_read_role="$(printf '%s\n' "$rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: ClusterRole\n/ && $0 ~ /\n  name: opencrane-silo-opencrane-server-ct-read-default\n/ { print $0 }
')"
ct_read_binding="$(printf '%s\n' "$rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: ClusterRoleBinding\n/ && $0 ~ /\n  name: opencrane-silo-opencrane-server-ct-read-default\n/ { print $0 }
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

test_digest="sha256:$(printf 'a%.0s' {1..64})"
enabled_rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set agentController.enabled=true \
  --set-string clustertenantManager.database.existingSecret=test-opencrane-db \
  --set-string agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32 \
  --set-string agentController.image.digest="$test_digest" \
  --set-string agentController.runtimeProfile.image.digest="$test_digest" \
  --set-string agentController.skillAuthoringValidation.image.digest="$test_digest" \
  --set-string opencrane-mcp-executor.mcpExecutor.image.digest="$test_digest")"
legacy_cleanup="$(printf '%s\n' "$enabled_rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: Role(Binding)?\n/ && $0 ~ /\n  name: opencrane-silo-runtime-cleanup\n/ { print $0 "---" }
')"
server_job_role="$(printf '%s\n' "$enabled_rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: Role\n/ && $0 ~ /app.kubernetes.io\/component: opencrane-server/ && $0 ~ /resources: \["jobs"\]/ { print $0 "---" }
')"
[[ -z "$legacy_cleanup" ]]
[[ -z "$server_job_role" ]]

echo "opencrane-server RBAC contract: PASS"
