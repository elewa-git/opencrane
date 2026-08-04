#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

for contract in \
  current-chart-sources-contract.sh \
  kubernetes-api-helm-args-contract.sh \
  pooler-deploy-contract.sh \
  server-key-permissions-contract.sh \
  server-runtime-cleanup-rbac-contract.sh \
  server-network-policy-contract.sh \
  platform-network-policy-contract.sh \
  post-deploy-health-contract.sh \
  skill-workload-contract.sh; do
  bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/$contract"
done
