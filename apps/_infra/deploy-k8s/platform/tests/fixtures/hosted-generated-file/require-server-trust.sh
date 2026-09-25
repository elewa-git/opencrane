#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:?repository root is required}"
FIXTURE_DIR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/fixtures/hosted-generated-file"

# A values key alone does not prove the server consumes it. Check the actual rendered workload
# before creating a cluster or credentials, so a chart change cannot silently drop the trust.
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap cleanup_current_chart_sources EXIT
prepare_current_chart_sources
helm template opencrane-smoke "$(current_chart_sources_dir)" \
  --namespace opencrane-develop-smoke \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set-string clustertenantManager.additionalCaCertificates.existingSecret=hosted-generated-file-ca \
  --set-string clustertenantManager.additionalCaCertificates.secretKey=ca.crt \
  --set-string clustertenantManager.additionalCaCertificates.revision=hosted-generated-file-v1 \
  | node "$FIXTURE_DIR/server-trust-contract.mjs"
