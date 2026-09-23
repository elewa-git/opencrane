#!/usr/bin/env bash

_SMOKE_REQUIRED_DOCKER_FREE_GIB="12"
_SMOKE_STORAGE_PROBE_IMAGE="busybox:1.36.1"
# Give BuildKit one GiB beyond the guard in exact bytes. Its `gb` suffix is decimal, and Docker may
# write metadata after pruning that leaves `df` just below the binary reserve.
_SMOKE_DOCKER_PRUNE_TARGET_GIB="$((_SMOKE_REQUIRED_DOCKER_FREE_GIB + 1))"
_SMOKE_DOCKER_PRUNE_TARGET_BYTES="$((_SMOKE_DOCKER_PRUNE_TARGET_GIB * 1024 * 1024 * 1024))"

# Fail before image builds or deployment pulls can turn exhausted Docker storage into node disk pressure.
_require_smoke_docker_free_space()
{
  local available_kib
  if ! available_kib="$(docker run --rm --pull=missing --network none --read-only \
    "$_SMOKE_STORAGE_PROBE_IMAGE" df -Pk / | awk 'NR == 2 { print $4 }')" \
    || [[ ! "$available_kib" =~ ^[0-9]+$ ]]; then
    echo "[develop-smoke] Could not measure free storage on Docker's backing filesystem." >&2
    return 1
  fi
  if [[ "$available_kib" -lt "$((_SMOKE_REQUIRED_DOCKER_FREE_GIB * 1024 * 1024))" ]]; then
    echo "[develop-smoke] Docker's backing filesystem has $((available_kib / 1024)) MiB free; Tier 3 minimum-host mode requires $((_SMOKE_REQUIRED_DOCKER_FREE_GIB * 1024)) MiB." >&2
    return 1
  fi
}

# Remove reproducible host dependencies and caches before image builds consume the minimum disk.
_prepare_smoke_host_storage()
{
  if [[ "$SMOKE_HOST_PROFILE" == "recommended" ]]; then
    return 0
  fi

  echo "[develop-smoke] Reclaiming host dependencies, package cache, and Docker caches for the minimum disk"
  rm -rf -- "$ROOT_DIR/node_modules"
  npm cache clean --force || return $?
  docker buildx prune --all --force --min-free-space "$_SMOKE_DOCKER_PRUNE_TARGET_BYTES" || return $?
  docker image prune --force || return $?
  _require_smoke_docker_free_space
}

# Keep the recommended and CI profiles' batch import and reusable cache. Minimum-disk Tier 3 releases
# each source after k3d accepts it, clears completed BuildKit cache, and checks the deployment reserve.
_import_smoke_images()
{
  local image
  if [[ "$SMOKE_HOST_PROFILE" == "recommended" ]]; then
    _retry 3 k3d image import "${SMOKE_IMAGES[@]}" --cluster "$CLUSTER_NAME" --mode direct
    return $?
  fi

  echo "[develop-smoke] Reclaiming Docker build cache until ${_SMOKE_DOCKER_PRUNE_TARGET_GIB} GiB is free, preserving the ${_SMOKE_REQUIRED_DOCKER_FREE_GIB} GiB deployment reserve"
  docker buildx prune --all --force --min-free-space "$_SMOKE_DOCKER_PRUNE_TARGET_BYTES" || return $?
  for image in "${SMOKE_IMAGES[@]}"; do
    echo "[develop-smoke] Importing and releasing $image"
    _retry 3 k3d image import "$image" --cluster "$CLUSTER_NAME" --mode direct || return $?
    docker image rm "$image" || return $?
  done
  docker image prune --force || return $?
  docker buildx prune --all --force || return $?
  _require_smoke_docker_free_space
}

# A pushed registry manifest remains available to k3d after its local source and temporary target
# tags are removed. Recommended hosts keep both tags for faster reruns.
_release_published_smoke_image()
{
  if [[ "$SMOKE_HOST_PROFILE" == "recommended" ]]; then
    return 0
  fi

  docker image rm "$@" >&2
}
