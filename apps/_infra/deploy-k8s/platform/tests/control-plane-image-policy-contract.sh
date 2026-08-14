#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/control-plane-image-policy.sh"

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
  CONTROL_PLANE_TAG=""
  CONTROL_PLANE_SPA_TAG=""
  CONTROL_PLANE_SPA_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  CONTROL_PLANE_SPA_IMAGE=""
  CP_TAG=""
  KUBERNETES_CONTEXT="gke_opencrane-dev_europe-west1_opencrane-dev"
}

_reset_inputs
if CONTROL_PLANE_SPA_TAG="sha-ui" resolve_control_plane_image_reference; then
  echo "a UI tag without the explicit local-only escape was accepted" >&2
  exit 1
fi

_reset_inputs
ALLOW_TAG_FLOAT=1
BASE_DOMAIN="develop-smoke.opencrane.test"
if resolve_control_plane_image_reference; then
  echo "a floating UI tag was accepted for a non-local context" >&2
  exit 1
fi

_reset_inputs
ALLOW_TAG_FLOAT=1
BASE_DOMAIN="develop-smoke.opencrane.test"
KUBERNETES_CONTEXT="k3d-develop-smoke"
CONTROL_PLANE_SPA_TAG="develop-smoke"
resolve_control_plane_image_reference
[[ "$CONTROL_PLANE_SPA_IMAGE" == "opencrane/opencrane-ui:develop-smoke" ]]

_reset_inputs
resolve_control_plane_image_reference
[[ "$CP_TAG" == "sha-server" ]]
[[ "$CONTROL_PLANE_SPA_IMAGE" == "ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]]

echo "control-plane image policy contract: PASS"
