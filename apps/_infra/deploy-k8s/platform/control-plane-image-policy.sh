#!/usr/bin/env bash

# Resolves the browser image reference used by the deployment engine. This small
# helper chooses that reference without reading or changing the cluster. A browser
# release uses an Open Container Initiative (OCI) digest; a local k3d conformance
# run may use an imported tag under `.test`. k8s-deploy.sh supplies the already-read
# context, looks up prior releases, and runs Helm.

# Decides whether a release that already pins the server image keeps that pin. Helm's
# reset-then-reuse does not preserve an omitted component override in a visible argument, so a run
# that states no tag inherits the prior one rather than falling back to the chart default. A run that
# passes --image-tag has stated its choice, so the server moves with every other component image —
# otherwise an operator bumping the release would silently leave the server behind.
# --opencrane-server-tag is a deliberate per-component override and always wins over both.
#
# Called by: k8s-deploy.sh (_resolve_release_images), before resolve_control_plane_image_reference.
select_control_plane_tag()
{
  local prior_server_tag="$1"

  if [[ -n "$CONTROL_PLANE_TAG" || -z "$prior_server_tag" ]]; then
    return 0
  fi
  if [[ "$IMAGE_TAG_SUPPLIED" == "1" ]]; then
    if [[ "$prior_server_tag" != "$IMAGE_TAG" ]]; then
      log "Moving the OpenCrane server off its prior pin '$prior_server_tag' to the requested --image-tag '$IMAGE_TAG'."
    fi
    return 0
  fi
  warn "Prior release pins the OpenCrane server to '$prior_server_tag'; reusing it. Pass --image-tag or --opencrane-server-tag to move it."
  CONTROL_PLANE_TAG="$prior_server_tag"
}

resolve_control_plane_image_reference()
{
  local requested_spa_tag="$CONTROL_PLANE_SPA_TAG"
  CP_TAG="${CONTROL_PLANE_TAG:-$IMAGE_TAG}"

  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    if [[ -z "$BASE_DOMAIN" || "$BASE_DOMAIN" != *.test ]]; then
      err "OPENCRANE_ALLOW_TAG_FLOAT=1 is restricted to a disposable local k3d .test domain. Deploy a browser release with --opencrane-ui-digest instead."
      return 1
    fi
    if [[ "${KUBERNETES_CONTEXT:-}" != k3d-* ]]; then
      err "OPENCRANE_ALLOW_TAG_FLOAT=1 is restricted to a local k3d context. Deploy a browser release with --opencrane-ui-digest instead."
      return 1
    fi
    CONTROL_PLANE_SPA_TAG="${CONTROL_PLANE_SPA_TAG:-$IMAGE_TAG}"
    CONTROL_PLANE_SPA_IMAGE="opencrane/opencrane-ui:${CONTROL_PLANE_SPA_TAG}"
    return 0
  fi

  if [[ -n "$requested_spa_tag" ]]; then
    err "--opencrane-ui-tag (or OPENCRANE_UI_TAG) is only allowed with OPENCRANE_ALLOW_TAG_FLOAT=1 on a disposable local k3d .test domain. Use --opencrane-ui-digest for a browser release."
    return 1
  fi

  if [[ "$CP_TAG" == "latest" ]]; then
    err "OpenCrane server must use a reviewed sha-* tag. Pass --image-tag or --opencrane-server-tag."
    return 1
  fi
  if [[ ! "$CONTROL_PLANE_SPA_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    err "OpenCrane SPA must use --opencrane-ui-digest with an exact sha256 OCI digest."
    return 1
  fi
  CONTROL_PLANE_SPA_IMAGE="ghcr.io/elewa-git/opencrane-ui@${CONTROL_PLANE_SPA_DIGEST}"
}
