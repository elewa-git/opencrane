#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/qualified-release-image-policy.sh"
DEPLOY_CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
FINALIZATION="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"

source "$POLICY"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ensure_umbrella_chart_dependencies

IMAGE_TAG="sha-f7d6771a4a5a075d424c7678d6165dd71c06b522"
CP_TAG="sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
AGENT_CONTROLLER_IMAGE_DIGEST="sha256:1111111111111111111111111111111111111111111111111111111111111111"
AGENT_RUNTIME_IMAGE_DIGEST="sha256:2222222222222222222222222222222222222222222222222222222222222222"
MCP_EXECUTOR_IMAGE_DIGEST="sha256:3333333333333333333333333333333333333333333333333333333333333333"
SKILL_AUTHORING_IMAGE_DIGEST="sha256:4444444444444444444444444444444444444444444444444444444444444444"
ARTIFACT_PREPROCESSOR_IMAGE_DIGEST="sha256:5555555555555555555555555555555555555555555555555555555555555555"
ARTIFACT_SCANNER_IMAGE_DIGEST="sha256:6666666666666666666666666666666666666666666666666666666666666666"
helm_args=(
  --set-string 'clustertenantManager.database.existingSecret=opencrane-app-db'
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
  --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
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
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-agent-controller@${AGENT_CONTROLLER_IMAGE_DIGEST}\"" <<<"$(_deployment agent-controller)"
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-artifact-scanner@${ARTIFACT_SCANNER_IMAGE_DIGEST}\"" <<<"$(_deployment opencrane-testv4-artifact-scanner)"
artifact_deployment="$(_deployment opencrane-testv4-artifact-service)"
grep -Fq 'namespace: opencrane-testv4-artifacts' <<<"$artifact_deployment"
grep -Fq "image: \"ghcr.io/elewa-git/opencrane-artifact-service:${IMAGE_TAG}\"" <<<"$artifact_deployment"

preflight_calls_file="$(mktemp)"
trap 'rm -f "$preflight_calls_file"' EXIT
ALLOW_TAG_FLOAT=0
log()
{
  :
}
warn()
{
  printf '%s\n' "$*" >&2
}
err()
{
  printf '%s\n' "$*" >&2
}
skopeo()
{
  if [[ "$1" == "inspect" && "$2" == "--format" ]]; then
    printf '%s\n' 'sha256:7777777777777777777777777777777777777777777777777777777777777777'
    return 0
  fi
  printf '%s\n' "$*" >>"$preflight_calls_file"
}
resolve_qualified_workflow_image_digests
[[ "$AGENT_CONTROLLER_IMAGE_DIGEST" == 'sha256:7777777777777777777777777777777777777777777777777777777777777777' ]]
[[ "$ARTIFACT_SCANNER_IMAGE_DIGEST" == 'sha256:7777777777777777777777777777777777777777777777777777777777777777' ]]
preflight_qualified_release_tag_images
grep -Fq "inspect docker://ghcr.io/elewa-git/opencrane-channel-proxy:${IMAGE_TAG}" "$preflight_calls_file"
grep -Fq "inspect docker://ghcr.io/elewa-git/opencrane-memory-gateway:${IMAGE_TAG}" "$preflight_calls_file"
grep -Fq "inspect docker://ghcr.io/elewa-git/opencrane-artifact-service:${IMAGE_TAG}" "$preflight_calls_file"
grep -Fq "inspect docker://ghcr.io/elewa-git/opencrane-server:${CP_TAG}" "$preflight_calls_file"
[[ "$(wc -l <"$preflight_calls_file" | tr -d ' ')" == "4" ]]
ALLOW_TAG_FLOAT=1
preflight_qualified_release_tag_images
[[ "$(wc -l <"$preflight_calls_file" | tr -d ' ')" == "4" ]]
ALLOW_TAG_FLOAT=0
IMAGE_TAG=latest
if preflight_qualified_release_tag_images; then
  echo "a public release without an explicit qualified --image-tag passed preflight" >&2
  exit 1
fi
IMAGE_TAG="sha-f7d6771a4a5a075d424c7678d6165dd71c06b522"
CP_TAG=production
if preflight_qualified_release_tag_images; then
  echo "a public release with a mutable server-only override passed preflight" >&2
  exit 1
fi
CP_TAG="sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if (
  unset -f skopeo
  command()
  {
    if [[ "$1" == '-v' ]]; then
      return 1
    fi
    builtin command "$@"
  }
  preflight_qualified_release_tag_images
); then
  echo "a public release without a registry inspector passed preflight" >&2
  exit 1
fi

grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-channel-proxy"' "$DEPLOY_CORE"
grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-memory-gateway"' "$DEPLOY_CORE"
grep -Fq 'wait_for_final_deployment_if_present "${RELEASE}-artifact-service" "$ARTIFACT_NAMESPACE"' "$DEPLOY_CORE"
grep -Fq 'local namespace="${2:-$NAMESPACE}"' "$FINALIZATION"
grep -Fq 'status.phase!=Running,status.phase!=Succeeded' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/post-deploy-verify.sh"

source "$FINALIZATION"
NAMESPACE=opencrane-testv4
TIMEOUT=37
rollout_calls_file="$(mktemp)"
trap 'rm -f "$preflight_calls_file" "$rollout_calls_file"' EXIT
kubectl()
{
  printf '%s\n' "$*" >>"$rollout_calls_file"
  if [[ "$1 $2" == 'get deployment/opencrane-testv4-artifact-service' ]]; then
    printf '%s\n' 'deployment.apps/opencrane-testv4-artifact-service'
  fi
}
wait_for_final_deployment_if_present opencrane-testv4-artifact-service opencrane-testv4-artifacts
grep -Fq 'get deployment/opencrane-testv4-artifact-service -n opencrane-testv4-artifacts --ignore-not-found -o name' "$rollout_calls_file"
grep -Fq 'rollout status deployment/opencrane-testv4-artifact-service -n opencrane-testv4-artifacts --timeout=37s' "$rollout_calls_file"

echo "qualified release image contract: PASS"
