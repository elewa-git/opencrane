#!/usr/bin/env bash

# Applies one reviewed image tag to every long-lived first-party service that is built from the
# same OpenCrane commit. The deploy engine calls this after operator-provided Helm values so a
# values file or command-line setter cannot split one qualified release across different builds.
append_authoritative_qualified_release_image_helm_args()
{
  local value_path
  for value_path in \
    channelProxy.image.tag \
    memoryGateway.image.tag \
    artifactService.image.tag; do
    helm_args+=(--set-literal "${value_path}=${IMAGE_TAG}")
  done
  helm_args+=(--set-literal "clustertenantManager.image.tag=${CP_TAG}")
}

# Prints each tagged first-party image that the release will run. The server may use its dedicated
# override, but the three auxiliary services always stay on the unified release tag.
qualified_release_tag_image_references()
{
  printf '%s\n' \
    "ghcr.io/elewa-git/opencrane-channel-proxy:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-memory-gateway:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-artifact-service:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-server:${CP_TAG}"
}

# Checks published tagged images before the deploy path makes its first Helm change. Local k3d uses
# images imported directly into its nodes, so a registry lookup cannot prove that path and is skipped.
preflight_qualified_release_tag_images()
{
  local image
  local inspector=""
  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    log "Local k3d image tags are verified by the blocking Deployment rollouts."
    return 0
  fi
  if [[ ! "$IMAGE_TAG" =~ ^sha-[0-9a-f]{7,64}$ ]]; then
    err "Public releases require --image-tag with an immutable sha-* build tag; '$IMAGE_TAG' is not qualified."
    return 1
  fi
  if [[ ! "$CP_TAG" =~ ^sha-[0-9a-f]{7,64}$ ]]; then
    err "A public server image override must use an immutable sha-* build tag; '$CP_TAG' is not qualified."
    return 1
  fi
  if command -v skopeo >/dev/null 2>&1; then
    inspector=skopeo
  elif command -v crane >/dev/null 2>&1; then
    inspector=crane
  elif command -v docker >/dev/null 2>&1; then
    inspector=docker
  else
    err "Public releases require skopeo, crane, or docker to preflight every tagged image before Helm changes the cluster."
    return 1
  fi
  while IFS= read -r image; do
    case "$inspector" in
      skopeo) skopeo inspect "docker://$image" >/dev/null 2>&1 ;;
      crane) crane manifest "$image" >/dev/null 2>&1 ;;
      docker) docker manifest inspect "$image" >/dev/null 2>&1 ;;
    esac || {
      err "Qualified first-party image is not pullable: $image"
      return 1
    }
  done < <(qualified_release_tag_image_references)
}
