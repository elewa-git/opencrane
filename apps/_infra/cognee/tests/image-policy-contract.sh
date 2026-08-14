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
}

_reset_inputs
resolve_cognee_image_reference
[[ "$COGNEE_IMAGE" == "ghcr.io/elewa-git/opencrane-cognee@${COGNEE_DIGEST}" ]]

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
