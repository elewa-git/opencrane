#!/usr/bin/env bash

# Resolves the Cognee image without reading or changing the cluster. Real silo deployments use an
# exact Open Container Initiative (OCI) digest. The disposable k3d smoke may use its imported local
# tag only behind the same explicit `.test` escape as the browser image.
resolve_cognee_image_reference()
{
  local repository="ghcr.io/elewa-git/opencrane-cognee"
  local requested_tag="$COGNEE_TAG"

  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    if [[ -z "$BASE_DOMAIN" || "$BASE_DOMAIN" != *.test ]]; then
      err "OPENCRANE_ALLOW_TAG_FLOAT=1 is restricted to a disposable local k3d .test domain. Deploy Cognee with --cognee-digest instead."
      return 1
    fi
    if [[ "${KUBERNETES_CONTEXT:-}" != k3d-* ]]; then
      err "OPENCRANE_ALLOW_TAG_FLOAT=1 is restricted to a local k3d context. Deploy Cognee with --cognee-digest instead."
      return 1
    fi
    COGNEE_TAG="${COGNEE_TAG:-$IMAGE_TAG}"
    COGNEE_DIGEST=""
    COGNEE_IMAGE="${repository}:${COGNEE_TAG}"
    return 0
  fi

  if [[ -n "$requested_tag" ]]; then
    err "--cognee-tag (or OPENCRANE_COGNEE_TAG) is only allowed with OPENCRANE_ALLOW_TAG_FLOAT=1 on disposable local k3d. Use --cognee-digest for a silo."
    return 1
  fi
  if [[ ! "$COGNEE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    err "Cognee must use --cognee-digest with an exact sha256 OCI digest."
    return 1
  fi

  COGNEE_TAG=""
  COGNEE_IMAGE="${repository}@${COGNEE_DIGEST}"
}
