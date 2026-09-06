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
  pooler-deploy-contract.sh \
  postgres-release-contract.sh \
  workflow-engine-qualification-contract.sh \
  server-key-permissions-contract.sh \
  server-rbac-contract.sh \
  server-network-policy-contract.sh \
  platform-network-policy-contract.sh \
  post-deploy-health-contract.sh \
  qualified-release-image-contract.sh \
  control-plane-image-policy-contract.sh \
  agent-sandbox-contract.sh \
  cluster-tenant-crd-policy-contract.sh \
  kurrentdb-bootstrap-secrets-contract.sh \
  kurrentdb-restore-contract.sh \
  silo-deploy-profile-contract.sh \
  silo-teardown-contract.sh \
  skill-authoring-contract.sh; do
  # Name every contract as it starts and on failure, so a silent `set -e` exit is still attributable in CI logs.
  echo "[contracts] $contract"
  if ! bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/$contract"; then
    echo "[contracts] FAILED: $contract" >&2
    exit 1
  fi
done
echo "[contracts] all passed"
