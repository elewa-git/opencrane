#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/qualified-release-image-policy.sh"
DEPLOY_CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
FINALIZATION="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"

source "$POLICY"

IMAGE_TAG="sha-f7d6771a4a5a075d424c7678d6165dd71c06b522"
CP_TAG="sha-server-override"
helm_args=(
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
  --set-string 'artifactService.namespace=opencrane-testv4-artifacts'
  --set-literal 'channelProxy.image.tag=latest'
  --set-literal 'memoryGateway.image.tag=0.1.0'
  --set-literal 'artifactService.image.tag=0.1.0'
  --set-literal 'clustertenantManager.image.tag=stale-server')
append_authoritative_qualified_release_image_helm_args

rendered="$(helm template opencrane-testv4 "$ROOT_DIR/apps/_infra/deploy-k8s" \
  "${helm_args[@]}" --show-only templates/app-rollups.yaml)"

_deployment()
{
  local name="$1"
  awk -v deployment_name="$name" 'BEGIN { RS="---" } $0 ~ "kind: Deployment" && $0 ~ "name: " deployment_name { print }' <<<"$rendered"
}

grep -Fq "image: \"ghcr.io/elewa-git/opencrane-server:${CP_TAG}\"" <<<"$(_deployment opencrane-testv4-opencrane-server)"
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-channel-proxy:${IMAGE_TAG}\"" <<<"$(_deployment opencrane-testv4-channel-proxy)"
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-memory-gateway:${IMAGE_TAG}\"" <<<"$(_deployment opencrane-testv4-memory-gateway)"
artifact_deployment="$(_deployment opencrane-testv4-artifact-service)"
grep -Fq 'namespace: opencrane-testv4-artifacts' <<<"$artifact_deployment"
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-artifact-service:${IMAGE_TAG}\"" <<<"$artifact_deployment"

grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-channel-proxy"' "$DEPLOY_CORE"
grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-memory-gateway"' "$DEPLOY_CORE"
grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-artifact-service" "$ARTIFACT_NAMESPACE"' "$DEPLOY_CORE"
grep -Fq 'local namespace="${2:-$NAMESPACE}"' "$FINALIZATION"
grep -Fq 'status.phase!=Running,status.phase!=Succeeded' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/post-deploy-verify.sh"

source "$FINALIZATION"
NAMESPACE=opencrane-testv4
TIMEOUT=37
rollout_calls_file="$(mktemp)"
trap 'rm -f "$rollout_calls_file"' EXIT
kubectl()
{
  printf '%s\n' "$*" >>"$rollout_calls_file"
  if [[ "$1 $2" == 'get deployment/opencrane-testv4-artifact-service' ]]; then
    printf '%s\n' 'deployment.apps/opencrane-testv4-artifact-service'
  fi
}
err()
{
  printf '%s\n' "$*" >&2
}
wait_for_final_deployment_if_present opencrane-testv4-artifact-service opencrane-testv4-artifacts
grep -Fq 'get deployment/opencrane-testv4-artifact-service -n opencrane-testv4-artifacts --ignore-not-found -o name' "$rollout_calls_file"
grep -Fq 'rollout status deployment/opencrane-testv4-artifact-service -n opencrane-testv4-artifacts --timeout=37s' "$rollout_calls_file"

echo "qualified release image contract: PASS"
