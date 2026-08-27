#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
MODULE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage.sh"
TEST_DIR="$(mktemp -d)"
REPOSITORY_FIXTURE="$TEST_DIR/repository"
CALL_LOG="$TEST_DIR/calls.log"
CONTAINER_STATE="$TEST_DIR/container"
VOLUME_STATE="$TEST_DIR/volume"
IMAGE_STATE="$TEST_DIR/image"
FAIL_IMPORT_IMAGE=""
STUBBORN_IMAGE="0"
STUBBORN_VOLUME="0"
VOLUME_LIST_VISIBLE="1"
VOLUME_LIST_ERROR="0"
FOREIGN_VOLUME_VISIBLE="0"
VOLUME_NAME="k3d-smoke-images"
DOCKER_AVAILABLE_KIB="$((13 * 1024 * 1024))"
trap 'rm -rf -- "$TEST_DIR"' EXIT

source "$MODULE"
ROOT_DIR="$REPOSITORY_FIXTURE"

_retry()
{
  local attempts="$1"
  local attempt=1
  shift
  until "$@"; do
    if [[ "$attempt" -ge "$attempts" ]]; then
      return 1
    fi
    attempt="$((attempt + 1))"
  done
}

_log_call()
{
  printf '%s\n' "$*" >> "$CALL_LOG"
}

_state_is_set()
{
  [[ "$(<"$1")" == "1" ]]
}

docker()
{
  _log_call "docker $*"
  if [[ "$1 $2" == "info --format" ]]; then
    printf '%s\n' "$ROOT_DIR"
    return 0
  fi
  if [[ "$1 $2" == "ps -aq" ]]; then
    _state_is_set "$CONTAINER_STATE" && printf '%s\n' container-1
    return 0
  fi
  if [[ "$1 $2" == "inspect --format" ]]; then
    _state_is_set "$VOLUME_STATE" && printf '%s\n' "$VOLUME_NAME"
    return 0
  fi
  if [[ "$1 $2" == "rm -f" ]]; then
    printf '0' > "$CONTAINER_STATE"
    return
  fi
  if [[ "$1 $2" == "volume rm" ]]; then
    if [[ "$3" == "$VOLUME_NAME" && "$STUBBORN_VOLUME" == "0" ]]; then
      printf '0' > "$VOLUME_STATE"
    fi
    return
  fi
  if [[ "$1 $2" == "volume ls" ]]; then
    if [[ "$VOLUME_LIST_ERROR" == "1" ]]; then
      return 1
    fi
    [[ "$VOLUME_LIST_VISIBLE" == "1" ]] && _state_is_set "$VOLUME_STATE" && printf '%s\n' "$VOLUME_NAME"
    [[ "$FOREIGN_VOLUME_VISIBLE" == "1" ]] && printf '%s\n' k3d-smoke-old-images
    return 0
  fi
  if [[ "$1 $2" == "image prune" ]]; then
    if [[ "$STUBBORN_IMAGE" == "0" ]]; then
      printf '0' > "$IMAGE_STATE"
    fi
    return
  fi
  if [[ "$1 $2" == "image ls" ]]; then
    _state_is_set "$IMAGE_STATE" && printf '%s\n' image-1
    return 0
  fi
  return 0
}

npm()
{
  _log_call "npm $*"
  return 0
}

df()
{
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
  printf 'fixture 33554432 0 %s 0%% %s\n' "$DOCKER_AVAILABLE_KIB" "$ROOT_DIR"
}

k3d()
{
  _log_call "k3d $*"
  if [[ "$1 $2" == "cluster delete" ]]; then
    printf '0' > "$CONTAINER_STATE"
    return
  fi
  if [[ "$1 $2" == "image import" && "$3" == "$FAIL_IMPORT_IMAGE" ]]; then
    return 1
  fi
  return 0
}

_reset_fixture()
{
  : > "$CALL_LOG"
  printf '%s' "${1:-0}" > "$CONTAINER_STATE"
  printf '%s' "${2:-0}" > "$VOLUME_STATE"
  printf '%s' "${3:-0}" > "$IMAGE_STATE"
  FAIL_IMPORT_IMAGE=""
  STUBBORN_IMAGE="0"
  STUBBORN_VOLUME="0"
  VOLUME_LIST_VISIBLE="1"
  VOLUME_LIST_ERROR="0"
  FOREIGN_VOLUME_VISIBLE="0"
  VOLUME_NAME="k3d-smoke-images"
  DOCKER_AVAILABLE_KIB="$((13 * 1024 * 1024))"
}

_assert_log()
{
  local expected="$1"
  local actual
  actual="$(<"$CALL_LOG")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Unexpected command order.\nExpected:\n%s\nActual:\n%s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

CLUSTER_NAME="smoke"
SMOKE_IMAGE_LABEL="opencrane.develop-smoke=true"
SMOKE_IMAGES=(image-a image-b)

# Prove CI does not clear host caches that later jobs can reuse.
_reset_fixture
SMOKE_HOST_PROFILE="recommended"
_prepare_smoke_host_storage
_assert_log ''

# Prove the minimum-host path removes existing dependencies and clears caches before image builds.
_reset_fixture
mkdir -p "$ROOT_DIR/node_modules"
SMOKE_HOST_PROFILE="minimum"
_prepare_smoke_host_storage
if [[ -e "$ROOT_DIR/node_modules" ]]; then
  echo "Minimum-host preparation must remove the reproducible workspace dependency tree." >&2
  exit 1
fi
_assert_log $'npm cache clean --force\ndocker buildx prune --all --force --min-free-space 12gb\ndocker image prune --force\ndocker info --format {{.DockerRootDir}}'

# Refuse to build when pruning succeeds but other Docker allocations still consume the reserve.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
DOCKER_AVAILABLE_KIB="$((11 * 1024 * 1024))"
if _prepare_smoke_host_storage 2>/dev/null; then
  echo "Minimum-host preparation must enforce its free-space reserve." >&2
  exit 1
fi

# Prove the default CI path keeps one batch import and does not reclaim reusable cache.
_reset_fixture
SMOKE_HOST_PROFILE="recommended"
_import_smoke_images
_assert_log 'k3d image import image-a image-b --cluster smoke --mode direct'

# Prove minimum-disk mode reclaims cache and releases each source after a successful import.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
_import_smoke_images
_assert_log $'docker buildx prune --all --force --min-free-space 12gb\nk3d image import image-a --cluster smoke --mode direct\ndocker image rm image-a\nk3d image import image-b --cluster smoke --mode direct\ndocker image rm image-b\ndocker image prune --force\ndocker info --format {{.DockerRootDir}}'

# Preserve a rejected source image so the developer can diagnose why k3d refused it.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
FAIL_IMPORT_IMAGE="image-b"
if _import_smoke_images; then
  echo "Low-disk import must fail when k3d rejects an image." >&2
  exit 1
fi
grep -Fq 'docker image rm image-a' "$CALL_LOG"
if grep -Fq 'docker image rm image-b' "$CALL_LOG"; then
  echo "A rejected image must remain available for diagnosis." >&2
  exit 1
fi

# Prove reset removes run-owned allocations without deleting a similarly named foreign volume.
_reset_fixture 1 1 1
FOREIGN_VOLUME_VISIBLE="1"
_reset_smoke_storage
_state_is_set "$CONTAINER_STATE" && { echo "Cluster containers survived reset." >&2; exit 1; }
_state_is_set "$VOLUME_STATE" && { echo "Cluster volumes survived reset." >&2; exit 1; }
_state_is_set "$IMAGE_STATE" && { echo "Smoke source images survived reset." >&2; exit 1; }
grep -Fq 'k3d cluster delete smoke' "$CALL_LOG"
grep -Fq 'docker volume rm k3d-smoke-images' "$CALL_LOG"
if grep -Fq 'docker volume rm k3d-smoke-old-images' "$CALL_LOG"; then
  echo "Reset must not remove a similarly named cluster volume." >&2
  exit 1
fi
grep -Fq 'docker image prune --all --force --filter label=opencrane.develop-smoke=true' "$CALL_LOG"

# Refuse to build while a labelled source image from the previous run remains.
_reset_fixture 0 0 1
STUBBORN_IMAGE="1"
if _reset_smoke_storage 2>/dev/null; then
  echo "Reset must fail while run-owned image storage remains." >&2
  exit 1
fi

# Refuse to build while an anonymous volume captured before cluster deletion remains.
_reset_fixture 1 1 0
STUBBORN_VOLUME="1"
VOLUME_NAME="anonymous-volume-1"
if _reset_smoke_storage 2>/dev/null; then
  echo "Reset must fail while a captured anonymous volume remains." >&2
  exit 1
fi

# Refuse to build when Docker cannot prove that its volume inventory is clear.
_reset_fixture
VOLUME_LIST_ERROR="1"
if _reset_smoke_storage 2>/dev/null; then
  echo "Reset must fail when Docker cannot verify its volume inventory." >&2
  exit 1
fi

echo "develop-smoke image storage contract: PASS"
