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
  --set-string networkPolicy.postgresPoolerName=opencrane-postgres-restored-pooler \
  --set-string networkPolicy.postgresPoolerServiceIp=10.96.42.17)"
runtime_rendered="$(helm template opencrane-silo "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set agentController.enabled=true \
  --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string agentController.skillWorkloadProfiles.authoring.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  --set-string agentController.skillWorkloadProfiles.toolRunner.image.digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')"
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
grep -Fq '              cnpg.io/poolerName: opencrane-postgres-restored-pooler' <<<"$server_policy"
grep -Fq '            cidr: "10.96.42.17/32"' <<<"$server_policy"
grep -Fq '          port: 5432' <<<"$server_policy"
grep -Fq '          port: 443' <<<"$server_policy"
grep -Fq '              kubernetes.io/metadata.name: kube-system' <<<"$server_policy"
grep -Fq '              k8s-app: kube-dns' <<<"$server_policy"
grep -Fq '          port: 53' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: litellm' <<<"$server_policy"
grep -Fq '          port: 4000' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: memory-gateway' <<<"$server_policy"
grep -Fq '          port: 8080' <<<"$server_policy"
grep -Fq '              kubernetes.io/metadata.name: "opencrane-silo-managed-runtime"' <<<"$runtime_server_policy"
grep -Fq '              app.kubernetes.io/component: agent-runtime' <<<"$runtime_server_policy"
grep -Fq 'value: "http://acme-opencrane-otel-collector.default.svc:4318"' <<<"$otel_rendered"
grep -Fq '              app.kubernetes.io/component: otel-collector' <<<"$otel_rendered"
if grep -Fq '          port: 4318' <<<"$otel_default_deny_rendered"; then
  echo "platform default-deny must not widen OTLP egress beyond app-owned collector selectors" >&2
  exit 1
fi

# The server now provisions custody and mints attempt keys against the release-local Obot
# management API, so the mcp-gateway egress rule must exist (tool payloads still bypass the server).
grep -Fq '              app.kubernetes.io/component: mcp-gateway' <<<"$server_policy"
grep -Fq '          port: 8080' <<<"$server_policy"

if grep -Fq 'cnpg.io/cluster' <<<"$server_policy"; then
  echo "opencrane-server policy bypasses the PostgreSQL pooler" >&2
  exit 1
fi

echo "opencrane-server network policy contract: PASS"
