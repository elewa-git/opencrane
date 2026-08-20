#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/control-plane-image-policy.sh"

source "$POLICY"

err()
{
  printf '%s\n' "$*" >&2
}

warn()
{
  printf '%s\n' "$*" >&2
}

log()
{
  printf '%s\n' "$*" >&2
}

_reset_inputs()
{
  ALLOW_TAG_FLOAT=0
  BASE_DOMAIN="testv4.dev.opencrane.ai"
  IMAGE_TAG="sha-server"
  IMAGE_TAG_SUPPLIED=0
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

# An explicit --image-tag moves the server past the pin the prior release recorded. Inheriting the
# pin here is how a release upgrade silently kept running the previous server build.
_reset_inputs
IMAGE_TAG="sha-requested"
IMAGE_TAG_SUPPLIED=1
select_control_plane_tag "sha-prior"
resolve_control_plane_image_reference
[[ "$CP_TAG" == "sha-requested" ]]

# A run that states no tag still inherits the pin, because reset-then-reuse would otherwise drop the
# server to the chart default.
_reset_inputs
select_control_plane_tag "sha-prior"
resolve_control_plane_image_reference
[[ "$CP_TAG" == "sha-prior" ]]

# A per-component override wins over both the prior pin and --image-tag.
_reset_inputs
IMAGE_TAG="sha-requested"
IMAGE_TAG_SUPPLIED=1
CONTROL_PLANE_TAG="sha-override"
select_control_plane_tag "sha-prior"
resolve_control_plane_image_reference
[[ "$CP_TAG" == "sha-override" ]]

# A fresh install has no pin to inherit.
_reset_inputs
select_control_plane_tag ""
resolve_control_plane_image_reference
[[ "$CP_TAG" == "sha-server" ]]

echo "control-plane image policy contract: PASS"
