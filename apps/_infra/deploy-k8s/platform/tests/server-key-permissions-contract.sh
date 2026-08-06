#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}")"
server_manifest="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if (is_deployment && is_server) {
      printf "%s", document
    }
    document = ""
    is_deployment = 0
    is_server = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: Deployment$/ {
    is_deployment = 1
  }
  /^  name: opencrane-silo-opencrane-server$/ {
    is_server = 1
  }
  END {
    flush_document()
  }
')"

[[ -n "$server_manifest" ]]
grep -Fq '        runAsUser: 1000' <<<"$server_manifest"
grep -Fq '        runAsGroup: 1000' <<<"$server_manifest"
grep -Fq '        fsGroup: 1000' <<<"$server_manifest"
grep -Fq '            defaultMode: 0440' <<<"$server_manifest"
grep -Fq '            - name: OPENCRANE_MEMBERSHIP_MODE' <<<"$server_manifest"
grep -Fq '              value: "standalone"' <<<"$server_manifest"
grep -Fq '            - name: OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS' <<<"$server_manifest"
if grep -Eq 'OPENCRANE_MEMBERSHIP_(ISSUER_ID|KEY_ID|PUBLIC_KEY_FILE)|membership-verification-key|fleet-membership' <<<"$server_manifest"; then
  echo "standalone server renders Fleet membership trust material" >&2
  exit 1
fi
grep -Fq '            - name: AGENT_RUNTIME_PERSONAL_NAMESPACE' <<<"$server_manifest"
grep -Fq '              value: "opencrane-silo-runtime"' <<<"$server_manifest"
grep -Fq '            - name: AGENT_RUNTIME_MANAGED_NAMESPACE' <<<"$server_manifest"
grep -Fq '              value: "opencrane-silo-managed-runtime"' <<<"$server_manifest"

# The memory-gateway caller credential must be an audience-bound projected token, group-readable
# only (0440), mounted where MEMORY_GATEWAY_TOKEN_PATH points.
grep -Fq '            - name: MEMORY_GATEWAY_URL' <<<"$server_manifest"
grep -Fq '            - name: MEMORY_GATEWAY_TOKEN_PATH' <<<"$server_manifest"
grep -Fq '              value: /var/run/opencrane/memory-gateway/token' <<<"$server_manifest"
grep -Fq '            - name: MEMORY_GATEWAY_TIMEOUT_SECONDS' <<<"$server_manifest"
grep -Fq '            - name: memory-gateway-token' <<<"$server_manifest"
grep -Fq '              mountPath: /var/run/opencrane/memory-gateway' <<<"$server_manifest"
memory_gateway_volume="$(grep -A 7 '        - name: memory-gateway-token' <<<"$server_manifest")"
grep -Fq '          projected:' <<<"$memory_gateway_volume"
grep -Fq '            defaultMode: 0440' <<<"$memory_gateway_volume"
grep -Fq '                  audience: opencrane-memory-gateway' <<<"$memory_gateway_volume"
grep -Fq '                  expirationSeconds: 600' <<<"$memory_gateway_volume"

if grep -Fq '            defaultMode: 0400' <<<"$server_manifest"; then
  echo "opencrane-server artifact keys are root-only" >&2
  exit 1
fi

# Provider credentials are owned by LiteLLM. The control plane may administer references, but it
# must never receive a bootstrap key or a broad provider-secret environment projection.
if grep -Eq 'OPENCRANE_BOOTSTRAP_OPENAI_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|envFrom:' <<<"$server_manifest"; then
  echo "opencrane-server renders a provider credential outside the LiteLLM boundary" >&2
  exit 1
fi

fleet_rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set clustertenantManager.membership.mode=fleet \
  --set clustertenantManager.membership.fleet.trustedIssuerId=opencrane-fleet \
  --set clustertenantManager.membership.fleet.issuerKeyId=fleet-key-1 \
  --set clustertenantManager.membership.fleet.existingSecret=opencrane-fleet-membership-verification)"
fleet_server_manifest="$(printf '%s\n' "$fleet_rendered" | awk '
  function flush_document() {
    if (is_deployment && is_server) {
      printf "%s", document
    }
    document = ""
    is_deployment = 0
    is_server = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: Deployment$/ {
    is_deployment = 1
  }
  /^  name: opencrane-silo-opencrane-server$/ {
    is_server = 1
  }
  END {
    flush_document()
  }
')"
grep -Fq '            - name: OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE' <<<"$fleet_server_manifest"
grep -Fq '              value: /var/run/opencrane/membership/public-key.pem' <<<"$fleet_server_manifest"
grep -Fq '            - name: membership-verification-key' <<<"$fleet_server_manifest"
grep -Fq '              mountPath: /var/run/opencrane/membership' <<<"$fleet_server_manifest"
grep -Fq '            secretName: "opencrane-fleet-membership-verification"' <<<"$fleet_server_manifest"

echo "opencrane-server key permissions contract: PASS"
