#!/usr/bin/env bash
# Verifies that the deploy engine passes the Kubernetes API Service and translated endpoint to the
# OpenCrane server and agent controller. Both workloads call the API, so omitting the endpoint CIDR
# blocks the server's provider-key request and leaves the agent profile restarting.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"

grep -Fq '_load_kubernetes_api_helm_args agentController "OpenCrane server and agent controller"' "$DEPLOY_SCRIPT"
grep -Fq 'AGENT_CONTROLLER_KUBERNETES_API_ARGS=("${KUBERNETES_API_HELM_ARGS[@]}")' "$DEPLOY_SCRIPT"
grep -Fq '"${AGENT_CONTROLLER_KUBERNETES_API_ARGS[@]}"' "$DEPLOY_SCRIPT"

echo "server Kubernetes API deploy contract: PASS"
