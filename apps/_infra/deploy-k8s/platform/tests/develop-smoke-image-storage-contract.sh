#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
MODULE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage.sh"
TEST_DIR="$(mktemp -d)"
REPOSITORY_FIXTURE="$TEST_DIR/repository"
CALL_LOG="$TEST_DIR/calls.log"
DOCKER_AVAILABLE_KIB="$((13 * 1024 * 1024))"
FAIL_IMPORT_IMAGE=""
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

docker()
{
  _log_call "docker $*"
  if [[ "$1" == "run" ]]; then
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
    printf 'fixture 33554432 0 %s 0%% /\n' "$DOCKER_AVAILABLE_KIB"
  fi
}

npm()
{
  _log_call "npm $*"
}

k3d()
{
  _log_call "k3d $*"
  if [[ "$1 $2" == "image import" && "$3" == "$FAIL_IMPORT_IMAGE" ]]; then
    return 1
  fi
}

_reset_fixture()
{
  : > "$CALL_LOG"
  DOCKER_AVAILABLE_KIB="$((13 * 1024 * 1024))"
  FAIL_IMPORT_IMAGE=""
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
SMOKE_IMAGES=(image-a image-b)

# The recommended and CI paths retain reusable dependencies and caches.
_reset_fixture
mkdir -p "$ROOT_DIR/node_modules"
SMOKE_HOST_PROFILE="recommended"
_prepare_smoke_host_storage
[[ -d "$ROOT_DIR/node_modules" ]]
_assert_log ''

# Minimum-host preparation removes reproducible dependencies and clears caches before image builds.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
_prepare_smoke_host_storage
if [[ -e "$ROOT_DIR/node_modules" ]]; then
  echo "Minimum-host preparation must remove the reproducible workspace dependency tree." >&2
  exit 1
fi
_assert_log $'npm cache clean --force\ndocker buildx prune --all --force --min-free-space 13958643712\ndocker image prune --force\ndocker run --rm --pull=missing --network none --read-only busybox:1.36.1 df -Pk /'

# Pruning cannot admit a minimum host when other Docker allocations still consume the reserve.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
DOCKER_AVAILABLE_KIB="$((11 * 1024 * 1024))"
if _prepare_smoke_host_storage 2>/dev/null; then
  echo "Minimum-host preparation must enforce its free-space reserve." >&2
  exit 1
fi

# Recommended hosts preserve one batch import and their reusable cache.
_reset_fixture
SMOKE_HOST_PROFILE="recommended"
_import_smoke_images
_assert_log 'k3d image import image-a image-b --cluster smoke --mode direct'

# Minimum hosts import and release sources one at a time, then restore the deployment reserve.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
_import_smoke_images
_assert_log $'docker buildx prune --all --force --min-free-space 13958643712\nk3d image import image-a --cluster smoke --mode direct\ndocker image rm image-a\nk3d image import image-b --cluster smoke --mode direct\ndocker image rm image-b\ndocker image prune --force\ndocker buildx prune --all --force\ndocker run --rm --pull=missing --network none --read-only busybox:1.36.1 df -Pk /'

# Keep a rejected source image available for diagnosis.
_reset_fixture
SMOKE_HOST_PROFILE="minimum"
FAIL_IMPORT_IMAGE="image-b"
if _import_smoke_images; then
  echo "Minimum-host import must fail when k3d rejects an image." >&2
  exit 1
fi
grep -Fq 'docker image rm image-a' "$CALL_LOG"
if grep -Fq 'docker image rm image-b' "$CALL_LOG"; then
  echo "A rejected source image must remain available for diagnosis." >&2
  exit 1
fi

# Registry-backed images follow the same retention policy after their immutable manifest is stored.
_reset_fixture
SMOKE_HOST_PROFILE="recommended"
_release_published_smoke_image source-image registry-image
_assert_log ''

_reset_fixture
SMOKE_HOST_PROFILE="minimum"
_release_published_smoke_image source-image registry-image
_assert_log 'docker image rm source-image registry-image'

echo "develop-smoke image storage contract: PASS"
