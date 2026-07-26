#!/usr/bin/env bash
# Ensures the deploy engine keeps every published application connection on the
# CNPG-managed Pooler rather than quietly restoring the direct `-rw` Service.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
K3D_E2E_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/k3d-e2e.sh"
K3D_LOCAL_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/k3d-local.sh"

grep -Fq 'POSTGRES_POOLER_HOST="${POSTGRES_RELEASE}-pooler"' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.postgresPoolerName=$POSTGRES_POOLER_HOST' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" opencrane "sslmode=disable&connection_limit=5&pool_timeout=5"' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" obot' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" litellm' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" langfuse' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_HOST" fleet' "$DEPLOY_SCRIPT"
grep -Fq 'langfuse.postgresql.host=${POSTGRES_POOLER_HOST}.${NAMESPACE}.svc.cluster.local' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerCidrs[0]' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerEndpointCidrs[$POSTGRES_KUBERNETES_API_ENDPOINT_INDEX]' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.kubernetesApiServerEndpointPort=$POSTGRES_KUBERNETES_API_ENDPOINT_PORT' "$DEPLOY_SCRIPT"

if grep -Fq 'langfuse.postgresql.host=${POSTGRES_RELEASE}-rw.' "$DEPLOY_SCRIPT"; then
  echo "Langfuse must use the CNPG Pooler, never the direct PostgreSQL Service." >&2
  exit 1
fi

grep -Fq 'deployment/${OPENCRANE_DB_RELEASE_NAME}-pooler' "$K3D_E2E_SCRIPT"
grep -Fq 'deployment/${RESTORE_DB_RELEASE_NAME}-pooler' "$K3D_E2E_SCRIPT"
grep -Fq '"${OPENCRANE_DB_RELEASE_NAME}-pooler" "$database_name"' "$K3D_E2E_SCRIPT"
grep -Fq '"${RESTORE_DB_RELEASE_NAME}-pooler" "$database_name"' "$K3D_E2E_SCRIPT"
grep -Fq 'networkPolicy.postgresPoolerName=${RESTORE_DB_RELEASE_NAME}-pooler' "$K3D_E2E_SCRIPT"
# The recovered Pooler must admit both its verification Jobs and every application
# that is later rewired to its Service. Egress-only admission is insufficient.
grep -Fq 'RESTORE_POOLER_CLIENT_SELECTORS_JSON=' "$K3D_E2E_SCRIPT"
for selector in \
  '"app.kubernetes.io/component":"postgres-restore-smoke"' \
  '"app.kubernetes.io/component":"opencrane-server"' \
  '"app.kubernetes.io/component":"mcp-gateway"' \
  '"app.kubernetes.io/component":"litellm"' \
  '"app.kubernetes.io/name":"langfuse"'; do
  grep -F 'RESTORE_POOLER_CLIENT_SELECTORS_JSON=' "$K3D_E2E_SCRIPT" \
    | grep -Fq "$selector"
done
grep -Fq 'pooler.clientPodSelectors=$RESTORE_POOLER_CLIENT_SELECTORS_JSON' "$K3D_E2E_SCRIPT"
grep -Fq 'deployment/${POSTGRES_RELEASE_NAME}-pooler' "$K3D_LOCAL_SCRIPT"
grep -Fq '"${POSTGRES_RELEASE_NAME}-pooler" "$database_name"' "$K3D_LOCAL_SCRIPT"
grep -Fq 'networkPolicy.postgresPoolerName=${POSTGRES_RELEASE_NAME}-pooler' "$K3D_LOCAL_SCRIPT"

echo "pooler deploy contract: PASS"
