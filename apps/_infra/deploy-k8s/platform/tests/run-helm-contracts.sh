#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

for contract in \
  bootstrap-prerequisites-contract.sh \
  bootstrap-prerequisites-render-contract.sh \
  current-chart-sources-contract.sh \
  provision-contract.sh \
  preflight-cni-contract.sh \
  kubernetes-api-helm-args-contract.sh \
  tier3-development-auth-contract.sh \
  runtime-continuation-keyring-secret-contract.sh \
  pooler-deploy-contract.sh \
  postgres-release-contract.sh \
  server-kubernetes-api-deploy-contract.sh \
  workflow-engine-qualification-contract.sh \
  server-key-permissions-contract.sh \
  server-rbac-contract.sh \
  server-network-policy-contract.sh \
  platform-network-policy-contract.sh \
  post-deploy-health-contract.sh \
  qualified-release-image-contract.sh \
  control-plane-image-policy-contract.sh \
  cluster-tenant-crd-policy-contract.sh \
  silo-deploy-profile-contract.sh \
  silo-teardown-contract.sh \
  retire-legacy-obot-custody-contract.sh \
  retire-legacy-obot-mcp-server-contract.sh \
  skill-authoring-contract.sh; do
  bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/$contract"
done
