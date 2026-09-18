#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

_report_contract_failure()
{
  local line_number="$1"
  printf 'LiteLLM security-context contract failed at line %s.\n' "$line_number" >&2
}

trap '_report_contract_failure "$LINENO"' ERR

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}")"
litellm_manifest="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if (is_deployment && is_litellm) { printf "%s", document }
    document = ""; is_deployment = 0; is_litellm = 0
  }
  /^---$/ { flush_document(); next }
  { document = document $0 ORS }
  /^kind: Deployment$/ { is_deployment = 1 }
  /^  name: opencrane-silo-litellm$/ { is_litellm = 1 }
  END { flush_document() }
')"

[[ -n "$litellm_manifest" ]]
grep -Fq '        runAsNonRoot: true' <<<"$litellm_manifest"
grep -Fq '        runAsUser: 65534' <<<"$litellm_manifest"
grep -Fq '        runAsGroup: 65534' <<<"$litellm_manifest"
grep -Fq '        fsGroup: 65534' <<<"$litellm_manifest"
grep -Fq '          image: "ghcr.io/berriai/litellm-non_root:main-v1.81.9-stable"' <<<"$litellm_manifest"
if grep -Fq 'runAsUser: 10001' <<<"$litellm_manifest"; then
  printf 'LiteLLM overrides the image-owned non-root identity.\n' >&2
  exit 1
fi

printf 'LiteLLM security-context contract: PASS\n'
