#!/usr/bin/env bash

_SMOKE_REQUIRED_DOCKER_FREE_GIB="12"
# Give BuildKit the reserve in bytes because its `gb` suffix is decimal while the guard below
# enforces binary GiB.
_SMOKE_REQUIRED_DOCKER_FREE_BYTES="$((_SMOKE_REQUIRED_DOCKER_FREE_GIB * 1024 * 1024 * 1024))"

# Lists only the image volume whose exact name belongs to this cluster, avoiding similarly prefixed volumes.
_list_cluster_image_volume()
{
  local volume
  while IFS= read -r volume; do
    if [[ "$volume" == "k3d-${CLUSTER_NAME}-images" ]]; then
      printf '%s\n' "$volume"
    fi
  done < <(docker volume ls -q 2>/dev/null || true)
}

# Checks a newline-delimited inventory without treating a volume-name prefix as ownership.
_volume_list_contains()
{
  local candidate="$2" volume
  while IFS= read -r volume; do
    if [[ "$volume" == "$candidate" ]]; then
      return 0
    fi
  done <<< "$1"
  return 1
}

# Remove every Docker allocation that belongs only to this disposable smoke run. Capture mounted
# volumes before k3d deletes its containers, because anonymous volume ownership then becomes hidden.
_teardown_cluster_storage()
{
  local containers volumes volume
  containers="$(docker ps -aq --filter "name=^k3d-${CLUSTER_NAME}-" 2>/dev/null || true)"
  volumes=""
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    volumes="$(docker inspect --format \
      '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' \
      $containers 2>/dev/null || true)"
  fi
  _SMOKE_CAPTURED_VOLUMES="$volumes"
  k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    docker rm -f -v $containers >/dev/null 2>&1 || true
  fi
  while IFS= read -r volume; do
    [[ -z "$volume" ]] && continue
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done <<< "$volumes"
  while IFS= read -r volume; do
    [[ -z "$volume" ]] && continue
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done < <(_list_cluster_image_volume)
  docker image prune --all --force --filter "label=${SMOKE_IMAGE_LABEL}" >/dev/null 2>&1 || true
}

# Fail before image builds if teardown cannot prove that this run's cluster storage is gone.
_reset_smoke_storage()
{
  local all_volumes containers image_volume images volume volumes
  _SMOKE_CAPTURED_VOLUMES=""
  _teardown_cluster_storage
  containers="$(docker ps -aq --filter "name=^k3d-${CLUSTER_NAME}-")"
  if ! all_volumes="$(docker volume ls -q)"; then
    echo "[develop-smoke] Docker volume verification failed while resetting '$CLUSTER_NAME'." >&2
    return 1
  fi
  image_volume="k3d-${CLUSTER_NAME}-images"
  volumes=""
  if _volume_list_contains "$all_volumes" "$image_volume"; then
    volumes="$image_volume"
  fi
  images="$(docker image ls --quiet --filter "label=${SMOKE_IMAGE_LABEL}")"
  if [[ -n "$containers" || -n "$volumes" || -n "$images" ]]; then
    echo "[develop-smoke] Run-owned Docker storage remains after resetting '$CLUSTER_NAME'." >&2
    return 1
  fi
  while IFS= read -r volume; do
    [[ -z "$volume" ]] && continue
    if _volume_list_contains "$all_volumes" "$volume"; then
      echo "[develop-smoke] Captured Docker volume '$volume' remains after resetting '$CLUSTER_NAME'." >&2
      return 1
    fi
  done <<< "$_SMOKE_CAPTURED_VOLUMES"
}

# Fail before k3d can turn exhausted Docker storage into node disk pressure.
_require_smoke_docker_free_space()
{
  local available_kib docker_root
  if ! docker_root="$(docker info --format '{{.DockerRootDir}}')" || [[ -z "$docker_root" ]]; then
    echo "[develop-smoke] Docker did not report its root directory for the disk-budget check." >&2
    return 1
  fi
  if ! available_kib="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')" \
    || [[ ! "$available_kib" =~ ^[0-9]+$ ]]; then
    echo "[develop-smoke] Could not measure free storage under Docker root '$docker_root'." >&2
    return 1
  fi
  if [[ "$available_kib" -lt "$((_SMOKE_REQUIRED_DOCKER_FREE_GIB * 1024 * 1024))" ]]; then
    echo "[develop-smoke] Docker root '$docker_root' has $((available_kib / 1024)) MiB free; Tier 3 minimum-host mode requires $((_SMOKE_REQUIRED_DOCKER_FREE_GIB * 1024)) MiB." >&2
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
  docker buildx prune --all --force --min-free-space "$_SMOKE_REQUIRED_DOCKER_FREE_BYTES" || return $?
  docker image prune --force || return $?
  _require_smoke_docker_free_space
}

# Keep CI's batch import. Minimum-disk Tier 3 releases each source after k3d accepts it, then
# prunes cache from the completed image builds before checking the 12 GiB reserve for deployment pulls.
_import_smoke_images()
{
  local image
  if [[ "$SMOKE_HOST_PROFILE" == "recommended" ]]; then
    _retry 3 k3d image import "${SMOKE_IMAGES[@]}" --cluster "$CLUSTER_NAME" --mode direct
    return $?
  fi

  echo "[develop-smoke] Reclaiming Docker build cache until ${_SMOKE_REQUIRED_DOCKER_FREE_GIB} GiB is free for the remaining workload images"
  docker buildx prune --all --force --min-free-space "$_SMOKE_REQUIRED_DOCKER_FREE_BYTES" || return $?
  for image in "${SMOKE_IMAGES[@]}"; do
    echo "[develop-smoke] Importing and releasing $image"
    _retry 3 k3d image import "$image" --cluster "$CLUSTER_NAME" --mode direct || return $?
    docker image rm "$image" || return $?
  done
  docker image prune --force || return $?
  docker buildx prune --all --force --min-free-space "$_SMOKE_REQUIRED_DOCKER_FREE_BYTES" || return $?
  _require_smoke_docker_free_space
}
