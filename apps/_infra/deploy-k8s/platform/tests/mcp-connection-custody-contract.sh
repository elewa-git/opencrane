#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
prepare_current_chart_sources
mcp_custody_test_directory="$(mktemp -d)"
trap 'cleanup_current_chart_sources; rm -rf "$mcp_custody_test_directory"' EXIT
CHART_DIR="$(current_chart_sources_dir)"
mcp_render_arguments=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

helm template first "$CHART_DIR" --namespace server-a "${mcp_render_arguments[@]}" > "$mcp_custody_test_directory/first.yaml"
helm template second "$CHART_DIR" --namespace server-a "${mcp_render_arguments[@]}" > "$mcp_custody_test_directory/second.yaml"
helm template first "$CHART_DIR" --namespace server-b "${mcp_render_arguments[@]}" > "$mcp_custody_test_directory/other-namespace.yaml"
node "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/mcp-connection-custody-assertions.mjs" "$mcp_custody_test_directory"

if helm template first "$CHART_DIR" "${mcp_render_arguments[@]}" --set-string clustertenantManager.mcpConnectionMaterialKeyring.existingSecret=opencrane-conversation-private-payload > "$mcp_custody_test_directory/reused-keyring.log" 2>&1; then
  echo "MCP material custody accepted the conversation encryption keyring" >&2
  exit 1
fi
grep -Fq 'MCP material and conversation payload keyrings must use separate Secrets' "$mcp_custody_test_directory/reused-keyring.log"
bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/mcp-material-keyring-contract.sh"
echo "MCP connection custody contract: PASS"
