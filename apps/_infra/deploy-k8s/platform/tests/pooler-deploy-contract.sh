#!/usr/bin/env bash
# Ensures the deploy engine keeps every published application connection on the
# CNPG-managed Pooler rather than quietly restoring the direct `-rw` Service.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
CONNECTION_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/postgres-connection.sh"
KUBERNETES_API_ARGS="$ROOT_DIR/apps/_infra/deploy-k8s/platform/kubernetes-api-helm-args.sh"

grep -Fq 'POSTGRES_POOLER_HOST="${POSTGRES_RELEASE}-pooler"' "$DEPLOY_SCRIPT"
grep -Fq 'POSTGRES_POOLER_CLIENT_HOST="${POSTGRES_POOLER_HOST}-client"' "$DEPLOY_SCRIPT"
grep -Fq 'source "$SCRIPT_DIR/postgres-connection.sh"' "$DEPLOY_SCRIPT"
grep -Fq 'networkPolicy.postgresPoolerName=$POSTGRES_POOLER_HOST' "$DEPLOY_SCRIPT"
grep -Fq 'publish_postgres_database_connection' "$CONNECTION_HELPER"
grep -Fq 'restart_postgres_connection_consumers' "$CONNECTION_HELPER"
grep -Fq '"$POSTGRES_POOLER_CLIENT_HOST" opencrane "sslmode=disable&connection_limit=5&pool_timeout=5"' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_CLIENT_HOST" obot' "$DEPLOY_SCRIPT"
grep -Fq '"$POSTGRES_POOLER_CLIENT_HOST" litellm' "$DEPLOY_SCRIPT"
grep -Fq '"${RELEASE}-opencrane-server" "${RELEASE}-litellm" "${RELEASE}-mcp-gateway"' "$DEPLOY_SCRIPT"
grep -Fq '_load_kubernetes_api_helm_args networkPolicy "PostgreSQL pooler"' "$DEPLOY_SCRIPT"
grep -Fq '_load_kubernetes_api_helm_args memoryGateway "memory gateway"' "$DEPLOY_SCRIPT"
grep -Fq '$values_prefix.kubernetesApiServerCidrs[0]' "$KUBERNETES_API_ARGS"
grep -Fq '$values_prefix.kubernetesApiServerEndpointCidrs[$endpoint_index]' "$KUBERNETES_API_ARGS"
grep -Fq '$values_prefix.kubernetesApiServerEndpointPort=$endpoint_port' "$KUBERNETES_API_ARGS"
grep -Fq '"${MEMORY_GATEWAY_KUBERNETES_API_ARGS[@]}"' "$DEPLOY_SCRIPT"

echo "pooler deploy contract: PASS"
