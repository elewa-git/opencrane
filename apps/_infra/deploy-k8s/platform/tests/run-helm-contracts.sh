#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

for contract in \
  bootstrap-prerequisites-contract.sh \
  bootstrap-prerequisites-render-contract.sh \
  current-chart-sources-contract.sh \
  provision-contract.sh \
  kubernetes-api-helm-args-contract.sh \
  initial-model-provider-helm-args-contract.sh \
  pooler-deploy-contract.sh \
  database-migration-deploy-contract.sh \
  database-superuser-access-contract.sh \
  database-convergence-classifier-contract.sh \
  database-pg-cron-preflight-contract.sh \
  database-convergence-policy-contract.sh \
  server-key-permissions-contract.sh \
  server-runtime-cleanup-rbac-contract.sh \
  server-network-policy-contract.sh \
  platform-network-policy-contract.sh \
  post-deploy-health-contract.sh \
  qualified-release-image-contract.sh \
  control-plane-image-policy-contract.sh \
  cluster-tenant-crd-policy-contract.sh \
  silo-deploy-profile-contract.sh \
  silo-teardown-contract.sh \
  skill-workload-contract.sh; do
  bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/$contract"
done
