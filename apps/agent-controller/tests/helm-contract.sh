#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

helm template oc "$ROOT/apps/_infra/deploy-k8s" \
  --set agentController.enabled=true \
  --set agentController.image.digest="sha256:$(printf 'a%.0s' {1..64})" \
  --set agentController.skillAuthoringValidation.image.digest="sha256:$(printf 'b%.0s' {1..64})" \
  --set opencrane-mcp-executor.mcpExecutor.image.digest="sha256:$(printf 'c%.0s' {1..64})" \
  --set clustertenantManager.database.url='postgresql://opencrane:opencrane@postgres:5432/opencrane' \
  --set agentController.kubernetesApiServerCidrs[0]=10.0.0.1/32 \
  --set memoryGateway.kubernetesApiServerCidrs[0]=10.0.0.1/32 \
  --set memoryGateway.kubernetesApiServerEndpointCidrs[0]=10.0.0.1/32 \
  > "$MANIFEST"

grep -Fq 'app.kubernetes.io/component: agent-controller' "$MANIFEST"
if grep -Eqi 'warm[-_ ]runtime|warmruntime|runtime-release|personal-warm|managed-warm' "$MANIFEST"; then
  echo 'agent-controller chart still renders the deleted warm-runtime authority' >&2
  exit 1
fi
