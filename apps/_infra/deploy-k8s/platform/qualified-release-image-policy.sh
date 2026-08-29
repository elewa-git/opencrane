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

  if [[ "${ALLOW_TAG_FLOAT:-0}" != "1" ]]; then
    helm_args+=(
      --set "agentController.enabled=true"
      --set "artifactPreprocessor.enabled=true"
      --set "artifactScanner.enabled=true"
      --set-literal "agentController.image.digest=${AGENT_CONTROLLER_IMAGE_DIGEST}"
      --set-literal "agentController.runtimeProfile.image.digest=${AGENT_RUNTIME_IMAGE_DIGEST}"
      --set-literal "agentController.skillAuthoringValidation.image.digest=${SKILL_AUTHORING_IMAGE_DIGEST}"
      --set-literal "opencrane-mcp-executor.mcpExecutor.image.digest=${MCP_EXECUTOR_IMAGE_DIGEST}"
      --set-literal "artifactPreprocessor.image.digest=${ARTIFACT_PREPROCESSOR_IMAGE_DIGEST}"
      --set-literal "artifactScanner.image.digest=${ARTIFACT_SCANNER_IMAGE_DIGEST}")
  fi
}

# Resolves the immutable manifests consumed by the workflow runtime charts. The public release tag
# selects one reviewed commit, while Helm receives exact digests so a later tag move cannot change a
# controller, runtime, MCP companion, skill validator, or artifact worker during a rollout.
resolve_qualified_workflow_image_digests()
{
  local image
  local digest
  local inspector=""
  local resolved=()

  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    return 0
  fi
  if [[ ! "$IMAGE_TAG" =~ ^sha-[0-9a-f]{7,64}$ ]]; then
    err "Workflow runtime images require --image-tag with an immutable sha-* build tag; '$IMAGE_TAG' is not qualified."
    return 1
  fi
  if command -v skopeo >/dev/null 2>&1; then
    inspector=skopeo
  elif command -v crane >/dev/null 2>&1; then
    inspector=crane
  elif command -v docker >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1; then
    inspector=docker
  else
    err "Workflow runtime digest resolution requires skopeo, crane, or docker buildx before Helm changes the cluster."
    return 1
  fi

  while IFS= read -r image; do
    case "$inspector" in
      skopeo) digest="$(skopeo inspect --format '{{.Digest}}' "docker://$image" 2>/dev/null)" ;;
      crane) digest="$(crane digest "$image" 2>/dev/null)" ;;
      docker) digest="$(docker buildx imagetools inspect "$image" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '\"')" ;;
    esac
    if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      err "Qualified workflow runtime image has no immutable registry digest: $image"
      return 1
    fi
    resolved+=("$digest")
  done < <(qualified_workflow_image_references)

  AGENT_CONTROLLER_IMAGE_DIGEST="${resolved[0]}"
  AGENT_RUNTIME_IMAGE_DIGEST="${resolved[1]}"
  MCP_EXECUTOR_IMAGE_DIGEST="${resolved[2]}"
  SKILL_AUTHORING_IMAGE_DIGEST="${resolved[3]}"
  ARTIFACT_PREPROCESSOR_IMAGE_DIGEST="${resolved[4]}"
  ARTIFACT_SCANNER_IMAGE_DIGEST="${resolved[5]}"
}

# Prints the workflow-owned images whose digests must be fixed into every public release render.
qualified_workflow_image_references()
{
  printf '%s\n' \
    "ghcr.io/elewa-git/opencrane-agent-controller:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-agent-runtime:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-mcp-executor:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-skill-authoring:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-artifact-preprocessor:${IMAGE_TAG}" \
    "ghcr.io/elewa-git/opencrane-artifact-scanner:${IMAGE_TAG}"
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
