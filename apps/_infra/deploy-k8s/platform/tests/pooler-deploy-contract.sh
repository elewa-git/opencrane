#!/usr/bin/env bash
# Ensures the deploy engine keeps every published application connection on the
# CNPG-managed Pooler rather than quietly restoring the direct `-rw` Service.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"

grep -Fq 'POSTGRES_POOLER_HOST="${POSTGRES_RELEASE}-pooler"' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.postgresPoolerName=$POSTGRES_POOLER_HOST' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" opencrane "sslmode=disable&connection_limit=5&pool_timeout=5"' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" obot' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" litellm' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerCidrs[0]' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerEndpointCidrs[$POSTGRES_KUBERNETES_API_ENDPOINT_INDEX]' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerEndpointPort=$POSTGRES_KUBERNETES_API_ENDPOINT_PORT' "$DEPLOY_SCRIPT"

echo "pooler deploy contract: PASS"
