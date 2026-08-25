#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-silo "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set-string opencrane-skill-authoring.skillAuthoring.namespace=authoring-contract \
  --set-string opencrane-skill-authoring.skillAuthoring.quota.pods=7 \
  --set-string opencrane-tool-runner.toolRunner.namespace=tool-contract \
  --set-string opencrane-tool-runner.toolRunner.quota.jobs=6 \
  --set-string opencrane-mcpb-validator.mcpbValidator.namespace=mcpb-contract)"

grep -Fq 'name: authoring-contract' <<<"$rendered"
grep -Fq 'namespace: authoring-contract' <<<"$rendered"
grep -Fq 'pods: "7"' <<<"$rendered"
grep -Fq 'name: tool-contract' <<<"$rendered"
grep -Fq 'namespace: tool-contract' <<<"$rendered"
grep -Fq 'count/jobs.batch: "6"' <<<"$rendered"
grep -Fq 'name: mcpb-contract' <<<"$rendered"

server_deployment="$(awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-silo-opencrane-server/ { print }' <<<"$rendered")"
grep -Fq 'name: SKILL_AUTHORING_NAMESPACE' <<<"$server_deployment"
grep -Fq 'value: "authoring-contract"' <<<"$server_deployment"

if helm template opencrane-silo "$CHART_DIR" --set-string opencrane-skill-authoring.skillAuthoring.namespace=shared-skills --set-string opencrane-tool-runner.toolRunner.namespace=shared-skills >/dev/null 2>&1; then
  echo "expected identical governed-skill namespaces to be rejected" >&2
  exit 1
fi

if helm template opencrane-silo "$CHART_DIR" --set-string opencrane-mcpb-validator.mcpbValidator.namespace=tool-contract --set-string opencrane-tool-runner.toolRunner.namespace=tool-contract >/dev/null 2>&1; then
  echo "expected MCP bundle validator namespace collision to be rejected" >&2
  exit 1
fi

if helm template opencrane-silo "$CHART_DIR" --set-string opencrane-skill-authoring.skillAuthoring.namespace="$(printf 'a%.0s' {1..64})" >/dev/null 2>&1; then
  echo "expected overlength skill-authoring namespace to be rejected" >&2
  exit 1
fi

echo "skill workload umbrella contract: PASS"
