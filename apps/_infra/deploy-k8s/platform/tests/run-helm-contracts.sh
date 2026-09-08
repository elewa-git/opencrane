#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

# The contracts rely on `set -e` stopping at the first false test. Bash 3.2 (the macOS default) does
# not stop on a false [[ ]] after a sourced script, so a local pass there proves less than CI does.
if (( BASH_VERSINFO[0] < 4 )); then
  echo "[contracts] WARNING: bash ${BASH_VERSION} does not enforce every assertion; treat CI (bash 5) as the authority or run with a newer bash" >&2
fi

for contract in \
  bootstrap-prerequisites-contract.sh \
  bootstrap-prerequisites-render-contract.sh \
  agent-sandbox-entrypoint-contract.sh \
  gke-snapshot-class-contract.sh \
  gke-standard-storage-class-contract.sh \
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
  kurrentdb-bootstrap-retry-contract.sh \
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
