#!/usr/bin/env bash
set -euo pipefail

POLICY="apps/_infra/cognee/deploy/image-policy.sh"
source "$POLICY"

err()
{
  printf '%s\n' "$*" >&2
}

_reset_inputs()
{
  ALLOW_TAG_FLOAT=0
  BASE_DOMAIN="testv4.dev.opencrane.ai"
  IMAGE_TAG="sha-server"
  COGNEE_TAG=""
  COGNEE_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  COGNEE_IMAGE=""
  KUBERNETES_CONTEXT="gke_weownai-proto_europe-west1_opencrane-dev"
  EXTRA_HELM_ARGS=()
  helm_args=()
}

_reset_inputs
resolve_cognee_image_reference
[[ "$COGNEE_IMAGE" == "ghcr.io/elewa-git/opencrane-cognee@${COGNEE_DIGEST}" ]]

EXTRA_HELM_ARGS=(
  --set-literal
  "clustertenantManager.cognee.image.repository=registry.invalid/alternate-cognee"
  --set-literal
  "clustertenantManager.cognee.image.digest="
  --set-literal
  "clustertenantManager.cognee.image.tag=latest")
validate_cognee_helm_passthrough
helm_args=("${EXTRA_HELM_ARGS[@]}")
append_authoritative_cognee_image_helm_args
argument_count="${#helm_args[@]}"
[[ "${helm_args[$((argument_count - 6))]}" == "--set-literal" ]]
[[ "${helm_args[$((argument_count - 5))]}" == "clustertenantManager.cognee.image.repository=$COGNEE_IMAGE_REPOSITORY" ]]
[[ "${helm_args[$((argument_count - 4))]}" == "--set-literal" ]]
[[ "${helm_args[$((argument_count - 3))]}" == "clustertenantManager.cognee.image.digest=$COGNEE_DIGEST" ]]
[[ "${helm_args[$((argument_count - 2))]}" == "--set-literal" ]]
[[ "${helm_args[$((argument_count - 1))]}" == "clustertenantManager.cognee.image.tag=" ]]

_reset_inputs
EXTRA_HELM_ARGS=(--post-renderer /tmp/rewrite-cognee-image)
if validate_cognee_helm_passthrough; then
  echo "a Helm post-renderer that can rewrite the verified Cognee image was accepted" >&2
  exit 1
fi

_reset_inputs
COGNEE_DIGEST=""
if resolve_cognee_image_reference; then
  echo "a remote Cognee deployment without a digest was accepted" >&2
  exit 1
fi

_reset_inputs
COGNEE_TAG="0.8.1"
if resolve_cognee_image_reference; then
  echo "a remote Cognee tag was accepted" >&2
  exit 1
fi

_reset_inputs
ALLOW_TAG_FLOAT=1
BASE_DOMAIN="develop-smoke.opencrane.test"
KUBERNETES_CONTEXT="k3d-develop-smoke"
COGNEE_TAG="develop-smoke"
resolve_cognee_image_reference
[[ "$COGNEE_DIGEST" == "" ]]
[[ "$COGNEE_IMAGE" == "ghcr.io/elewa-git/opencrane-cognee:develop-smoke" ]]

echo "Cognee image policy contract: PASS"
