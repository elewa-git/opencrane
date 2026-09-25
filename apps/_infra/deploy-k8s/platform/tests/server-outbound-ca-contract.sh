#!/usr/bin/env bash
set -euo pipefail

# Optional outbound CA trust is off unless the operator names a pre-created Secret. When it is on,
# only the server process receives the bundle, through the exact read-only shape the hosted smoke
# gate checks. A bundle without its revision label is refused, because Node reads the file only at
# start-up and the label is what restarts the Pod after the Secret changes.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

_report_contract_failure()
{
  local line_number="$1"
  printf 'opencrane-server outbound CA contract failed at line %s.\n' "$line_number" >&2
}

trap '_report_contract_failure "$LINENO"' ERR

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')
CA_ARGS=(
  --set-string clustertenantManager.additionalCaCertificates.existingSecret=private-registry-ca
  --set-string clustertenantManager.additionalCaCertificates.secretKey=ca.crt
  --set-string clustertenantManager.additionalCaCertificates.revision=private-registry-ca-v1
)

# 1. The default release trusts only Node's built-in roots.
default_render="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}")"
if grep -Eq 'NODE_EXTRA_CA_CERTS|additional-ca-certificates|opencrane.ai/additional-ca-certificates-revision' <<<"$default_render"; then
  echo "the default render must not add outbound CA trust" >&2
  exit 1
fi

# 2. A configured bundle reaches exactly one container: the server.
configured_render="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" "${CA_ARGS[@]}")"
[[ "$(grep -c 'name: NODE_EXTRA_CA_CERTS' <<<"$configured_render")" == "1" ]]
[[ "$(grep -c 'secretName: "private-registry-ca"' <<<"$configured_render")" == "1" ]]

# 3. The rendered shape is the one the hosted smoke gate accepts.
bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/fixtures/hosted-generated-file/require-server-trust.sh" "$ROOT_DIR"

# 4. A bundle without its revision label or Secret key is refused before anything is applied.
for missing in revision secretKey; do
  if helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" "${CA_ARGS[@]}" \
      --set-string "clustertenantManager.additionalCaCertificates.${missing}=" >/dev/null 2>&1; then
    echo "a CA bundle without ${missing} must fail to render" >&2
    exit 1
  fi
done

echo "opencrane-server outbound CA contract: PASS"
