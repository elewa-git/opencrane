#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
DOCKERFILE="$ROOT_DIR/apps/feat-openclaw-tenant/deploy/Dockerfile"
ENTRYPOINT="$ROOT_DIR/apps/feat-openclaw-tenant/deploy/entrypoint.sh"

function _assert_no_match()
{
  local pattern="$1"
  local file="$2"
  local status=0

  grep -qsE -- "$pattern" "$file" || status=$?
  case "$status" in
    0)
      echo "[tenant-image] ERROR: mutable startup path remains in $file" >&2
      return 1
      ;;
    1)
      return 0
      ;;
    *)
      echo "[tenant-image] ERROR: unable to inspect $file" >&2
      return "$status"
      ;;
  esac
}

# Static gate runs everywhere: exact pins are image-build inputs and startup cannot install code.
grep -qE '^ARG OPENCLAW_VERSION=2026\.6\.11$' "$DOCKERFILE"
grep -qE '^ARG COGNEE_PLUGIN_VERSION=2026\.7\.9$' "$DOCKERFILE"
grep -qE 'npm install --prefix /opt/openclaw' "$DOCKERFILE"
_assert_no_match 'npm install|plugins install|STATE_DIR.*/runtime|/shared-skills' "$ENTRYPOINT"

echo "[tenant-image] PASS: immutable build pins and install-free startup contract"

# The source-only gate is useful locally, but it must never claim runtime rollback coverage. CI
# supplies both images in the dedicated rollback job below; a partially configured invocation is
# an error rather than a silent skip.
if [[ -z "${CURRENT_IMAGE:-}" && -z "${PREVIOUS_IMAGE:-}" ]]; then
  echo "[tenant-image] SKIP: runtime cold-start/rollback requires CURRENT_IMAGE and PREVIOUS_IMAGE"
  exit 0
fi
if [[ -z "${CURRENT_IMAGE:-}" || -z "${PREVIOUS_IMAGE:-}" ]]; then
  echo "[tenant-image] ERROR: set both CURRENT_IMAGE and PREVIOUS_IMAGE" >&2
  exit 1
fi

# Run current then previous through the real entrypoint against the same initially-empty state
# volume. Each boot must reach the gateway launch, report its baked runtime, and leave executable
# code off the PVC. Distinct versions prove this is a real rollback, not the same image under two
# tags.
volume="opencrane-tenant-rollback-${RANDOM}"
container=""
trap '
  [[ -z "$container" ]] || docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
' EXIT
docker volume create "$volume" >/dev/null
versions=()
index=0
for image in "$CURRENT_IMAGE" "$PREVIOUS_IMAGE"; do
  index=$((index + 1))
  container="opencrane-tenant-rollback-${RANDOM}-${index}"
  docker run --detach --name "$container" -v "$volume:/data/openclaw" "$image" >/dev/null

  started="false"
  for _ in $(seq 1 20); do
    if ! logs="$(docker logs "$container" 2>&1)"; then
      echo "[tenant-image] ERROR: unable to read startup logs for $container" >&2
      exit 1
    fi
    if grep -q 'Starting OpenClaw gateway' <<< "$logs"; then
      started="true"
      break
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "$started" != "true" ]]; then
    docker logs "$container" >&2 || true
    echo "[tenant-image] ERROR: $image did not complete cold-start initialization" >&2
    exit 1
  fi
  docker rm -f "$container" >/dev/null
  container=""

  version="$(docker run --rm --entrypoint openclaw "$image" --version)"
  docker run --rm --entrypoint sh -v "$volume:/data/openclaw" "$image" -c '
    test -f /opt/openclaw/node_modules/@cognee/cognee-openclaw/package.json
    test -d /data/openclaw/workspace
    test ! -e /data/openclaw/runtime
    test ! -e /data/openclaw/extensions
  '
  [[ -n "$version" ]]
  versions+=("$version")
done
if [[ "${versions[0]}" == "${versions[1]}" ]]; then
  echo "[tenant-image] ERROR: current and previous images report the same runtime version" >&2
  exit 1
fi

echo "[tenant-image] PASS: cold-empty current image and previous-version rollback share a code-free state volume"
