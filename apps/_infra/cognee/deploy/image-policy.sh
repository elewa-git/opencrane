#!/usr/bin/env bash

# Resolves the Cognee image without reading or changing the cluster. Real silo deployments use an
# exact Open Container Initiative (OCI) digest. The disposable k3d smoke may use its imported local
# tag only behind the same explicit `.test` escape as the browser image.
readonly COGNEE_IMAGE_REPOSITORY="ghcr.io/elewa-git/opencrane-cognee"

resolve_cognee_image_reference()
{
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
    COGNEE_IMAGE="${COGNEE_IMAGE_REPOSITORY}:${COGNEE_TAG}"
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
  COGNEE_IMAGE="${COGNEE_IMAGE_REPOSITORY}@${COGNEE_DIGEST}"
}

# Reject Helm post-rendering because it runs after every value and can rewrite the verified image.
# Ordinary values and --set passthrough remain supported; the authoritative tuple is appended last.
validate_cognee_helm_passthrough()
{
  local argument
  for argument in "${EXTRA_HELM_ARGS[@]-}"; do
    case "$argument" in
      --post-renderer|--post-renderer=*|--post-renderer-args|--post-renderer-args=*)
        err "Cognee's verified image cannot be combined with Helm post-renderer passthrough."
        return 1
        ;;
    esac
  done
}

# Appends the complete verified image tuple after all operator-controlled values and Helm
# passthrough. Helm merges literal setters last, so the final literal tuple also outranks hostile
# lower-precedence setter classes supplied earlier on the command line.
append_authoritative_cognee_image_helm_args()
{
  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    helm_args+=(
      --set-literal "clustertenantManager.cognee.image.repository=$COGNEE_IMAGE_REPOSITORY"
      --set-literal "clustertenantManager.cognee.image.digest="
      --set-literal "clustertenantManager.cognee.image.tag=$COGNEE_TAG")
    return
  fi
  helm_args+=(
    --set-literal "clustertenantManager.cognee.image.repository=$COGNEE_IMAGE_REPOSITORY"
    --set-literal "clustertenantManager.cognee.image.digest=$COGNEE_DIGEST"
    --set-literal "clustertenantManager.cognee.image.tag=")
}
