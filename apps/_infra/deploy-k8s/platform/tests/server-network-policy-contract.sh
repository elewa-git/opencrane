#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-silo "$CHART_DIR" --namespace pooler-ns \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set-string networkPolicy.postgresPoolerName=opencrane-postgres-restored-pooler \
  --set-string networkPolicy.postgresPoolerServiceIp=10.96.42.17)"
runtime_rendered="$(helm template opencrane-silo "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set agentController.enabled=true \
  --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string agentController.skillWorkloadProfiles.authoring.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  --set-string agentController.skillWorkloadProfiles.toolRunner.image.digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --set-string opencrane-mcp-executor.mcpExecutor.image.digest=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set agentController.kubernetesApiServerEndpointPort=6443)"
lease_rendered="$(helm template opencrane-silo "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set opencrane-mcp-executor.mcpExecutor.controllerClaimLeaseSeconds=47 \
  --set opencrane-mcp-executor.mcpExecutor.companionClaimLeaseSeconds=181)"
otel_rendered="$(helm template acme "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" --set observability.otel.enabled=true)"
otel_default_deny_rendered="$(helm template acme "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set observability.otel.enabled=true \
  --set networkPolicy.mainNetworkDefaultDeny.enabled=true \
  --show-only templates/networkpolicy-main-default-deny.yaml)"
server_policy="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if (is_policy && is_server_policy) {
      printf "%s", document
    }
    document = ""
    is_policy = 0
    is_server_policy = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: NetworkPolicy$/ {
    is_policy = 1
  }
  /^  name: opencrane-silo-opencrane-server$/ {
    is_server_policy = 1
  }
  END {
    flush_document()
  }
')"
runtime_server_policy="$(printf '%s\n' "$runtime_rendered" | awk '
  function flush_document() {
    if (is_policy && is_server_policy) {
      printf "%s", document
    }
    document = ""
    is_policy = 0
    is_server_policy = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: NetworkPolicy$/ {
    is_policy = 1
  }
  /^  name: opencrane-silo-opencrane-server$/ {
    is_server_policy = 1
  }
  END {
    flush_document()
  }
')"

[[ -n "$server_policy" ]]
if grep -Fq 'cnpg.io/poolerName:' <<<"$server_policy"; then
  echo "GKE ClusterIP Pooler traffic must use the port-limited egress rule; Pod selection happens at Pooler ingress" >&2
  exit 1
fi
if grep -Fq 'cidr: "10.96.42.17/32"' <<<"$server_policy"; then
  echo "opencrane-server policy must not target the Pooler ClusterIP by IP" >&2
  exit 1
fi
grep -Fq '          port: 5432' <<<"$server_policy"
grep -Fq '          port: 443' <<<"$server_policy"
grep -Fq '          port: 53' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: litellm' <<<"$server_policy"
grep -Fq '          port: 4000' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: memory-gateway' <<<"$server_policy"
grep -Fq '          port: 8080' <<<"$server_policy"
grep -Fq '              kubernetes.io/metadata.name: "opencrane-silo-managed-runtime"' <<<"$runtime_server_policy"
grep -Fq '              app.kubernetes.io/component: agent-runtime' <<<"$runtime_server_policy"
grep -Fq '            cidr: "10.43.0.1/32"' <<<"$runtime_server_policy"
grep -Fq '            cidr: "172.18.0.2/32"' <<<"$runtime_server_policy"
grep -Fq '          port: 6443' <<<"$runtime_server_policy"
grep -A1 -F 'name: MCP_CONTROLLER_CLAIM_LEASE_SECONDS' <<<"$lease_rendered" | grep -F 'value: "47"' >/dev/null
grep -A1 -F 'name: MCP_COMPANION_CLAIM_LEASE_SECONDS' <<<"$lease_rendered" | grep -F 'value: "181"' >/dev/null
grep -Fq 'value: "http://acme-opencrane-otel-collector.default.svc:4318"' <<<"$otel_rendered"
grep -Fq '              app.kubernetes.io/component: otel-collector' <<<"$otel_rendered"
if grep -Fq '          port: 4318' <<<"$otel_default_deny_rendered"; then
  echo "platform default-deny must not widen OTLP egress beyond app-owned collector selectors" >&2
  exit 1
fi

# The server owns both custody and durable provider action execution, so its MCP egress remains.
grep -Fq '              app.kubernetes.io/component: mcp-gateway' <<<"$server_policy"
grep -Fq '          port: 8080' <<<"$server_policy"

if grep -Fq 'cnpg.io/cluster' <<<"$server_policy"; then
  echo "opencrane-server policy bypasses the PostgreSQL pooler" >&2
  exit 1
fi
if grep -Fq 'k8s-app: kube-dns' <<<"$server_policy"; then
  echo "GKE ClusterIP DNS traffic must use the port-limited egress rule" >&2
  exit 1
fi

echo "opencrane-server network policy contract: PASS"
