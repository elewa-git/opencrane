#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ "$#" -ne 1 || -z "$1" ]]; then
  echo "usage: memory-contract.sh <locally-available-image-reference>" >&2
  exit 2
fi

readonly image="$1"
readonly root_dir="$(git rev-parse --show-toplevel)"
readonly fixture_dir="$root_dir/apps/_infra/cognee/tests/fixtures"
readonly requested_output_dir="${OUTPUT_DIR:-$root_dir/.nx/test-results/cognee-memory-contract}"
mkdir -p "$requested_output_dir"
readonly output_dir="$(cd "$requested_output_dir" && pwd)"
readonly run_suffix="${GITHUB_RUN_ID:-local}-$$-$RANDOM"
readonly network="opencrane-memory-contract-$run_suffix"
readonly stub="opencrane-memory-stub-$run_suffix"
readonly proxy="opencrane-memory-drop-$run_suffix"
readonly negative="opencrane-cognee-negative-$run_suffix"
readonly positive="opencrane-cognee-positive-$run_suffix"
readonly negative_volume="opencrane-cognee-negative-$run_suffix"
readonly positive_volume="opencrane-cognee-positive-$run_suffix"
current_case="initialize"

rm -f \
  "$output_dir/evidence.json" \
  "$output_dir/source-evidence.json" \
  "$output_dir/negative-control.json" \
  "$output_dir/positive-initial.json" \
  "$output_dir/positive-recovery.json" \
  "$output_dir/positive-state.json" \
  "$output_dir/negative-state.json" \
  "$output_dir/stub-requests.jsonl" \
  "$output_dir/commit-then-drop.jsonl"

_capture_logs()
{
  local container
  for container in "$stub" "$proxy" "$negative" "$positive"; do
    if docker container inspect "$container" >/dev/null 2>&1; then
      docker logs "$container" >"$output_dir/$container.log" 2>&1 || true
    fi
  done
}

_cleanup()
{
  local status="$?"
  _capture_logs
  if [[ "$status" -ne 0 ]]; then
    set +e
    python3 "$fixture_dir/evidence_summary.py" \
      --image "$image" \
      --image-inspect "$output_dir/image-inspect.json" \
      --source "$output_dir/source-evidence.json" \
      --negative "$output_dir/negative-control.json" \
      --positive-initial "$output_dir/positive-initial.json" \
      --positive "$output_dir/positive-recovery.json" \
      --stub-log "$output_dir/stub-requests.jsonl" \
      --drop-log "$output_dir/commit-then-drop.jsonl" \
      --expected-drop-path /api/v1/add \
      --output "$output_dir/evidence.json" \
      --failure-status "$status" \
      --failed-case "$current_case" \
      >"$output_dir/evidence-summary.log" 2>&1
    set -e
  fi
  docker rm -f "$stub" "$proxy" "$negative" "$positive" >/dev/null 2>&1 || true
  docker volume rm "$negative_volume" "$positive_volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$status"
}
trap _cleanup EXIT INT TERM

command -v docker >/dev/null
current_case="docker_daemon_and_image_available"
docker info >/dev/null
docker image inspect "$image" >"$output_dir/image-inspect.json"
current_case="source_module_attestation"
docker run --rm \
  --network none \
  --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
  --mount "type=bind,source=$output_dir,target=/contract-output" \
  --entrypoint python \
  "$image" /contract/source_evidence.py \
  --expected /contract/expected-source-hashes.json \
  --output /contract-output/source-evidence.json \
  | tee "$output_dir/source-evidence.log"
docker network create --internal "$network" >/dev/null
docker volume create "$negative_volume" >/dev/null
docker volume create "$positive_volume" >/dev/null
: >"$output_dir/stub-requests.jsonl"
: >"$output_dir/commit-then-drop.jsonl"

docker run -d \
  --name "$stub" \
  --network "$network" \
  --network-alias openai-stub \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
  --mount "type=bind,source=$output_dir,target=/contract-output" \
  --env STUB_METADATA_LOG=/contract-output/stub-requests.jsonl \
  --env STUB_DIMENSIONS=1536 \
  --entrypoint python \
  "$image" /contract/openai_stub.py >/dev/null

_wait_for_url()
{
  local container="$1"
  local url="$2"
  local attempt
  for attempt in $(seq 1 90); do
    if docker exec "$container" python -c "import urllib.request; urllib.request.urlopen('$url', timeout=2).read()" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "bounded readiness failed for $container at $url" >&2
  return 1
}

_wait_for_url "$stub" "http://127.0.0.1:8090/health"

_start_cognee()
{
  local container="$1"
  local volume="$2"
  local access_control="$3"
  local require_authentication="$4"
  docker run -d \
    --name "$container" \
    --network "$network" \
    --network-alias cognee \
    --mount "type=volume,source=$volume,target=/cognee-data" \
    --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
    --mount "type=bind,source=$output_dir,target=/contract-output" \
    --env HOST=0.0.0.0 \
    --env PORT=8000 \
    --env "ENABLE_BACKEND_ACCESS_CONTROL=$access_control" \
    --env "REQUIRE_AUTHENTICATION=$require_authentication" \
    --env DATA_ROOT_DIRECTORY=/cognee-data/data_storage \
    --env SYSTEM_ROOT_DIRECTORY=/cognee-data/cognee_system \
    --env LLM_PROVIDER=openai \
    --env LLM_MODEL=openai/gpt-4o-mini \
    --env LLM_ENDPOINT=http://openai-stub:8090/v1 \
    --env LLM_API_KEY=test-only-memory-contract \
    --env EMBEDDING_PROVIDER=openai_compatible \
    --env EMBEDDING_MODEL=text-embedding-3-small \
    --env EMBEDDING_DIMENSIONS=1536 \
    --env EMBEDDING_ENDPOINT=http://openai-stub:8090/v1 \
    --env EMBEDDING_API_KEY=test-only-memory-contract \
    "$image" >/dev/null
  _wait_for_url "$container" "http://127.0.0.1:8000/openapi.json"
}

current_case="acl_disabled_negative_control"
_start_cognee "$negative" "$negative_volume" false false
docker exec "$negative" python /contract/provider_contract.py \
  --phase initial \
  --mode acl-disabled \
  --namespace "$run_suffix" \
  --base-url http://cognee:8000 \
  --state /contract-output/negative-state.json \
  --output /contract-output/negative-control.json \
  | tee "$output_dir/negative-control.log"
docker logs "$negative" >"$output_dir/acl-disabled-provider.log" 2>&1
docker rm -f "$negative" >/dev/null

current_case="acl_enabled_initial_contract"
_start_cognee "$positive" "$positive_volume" true true
docker run -d \
  --name "$proxy" \
  --network "$network" \
  --network-alias drop-proxy \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
  --mount "type=bind,source=$output_dir,target=/contract-output" \
  --env UPSTREAM_HOST=cognee \
  --env UPSTREAM_PORT=8000 \
  --env DROP_METADATA_LOG=/contract-output/commit-then-drop.jsonl \
  --entrypoint python \
  "$image" /contract/commit_then_drop_proxy.py >/dev/null
_wait_for_url "$proxy" "http://127.0.0.1:8091/health"

docker exec "$positive" python /contract/provider_contract.py \
  --phase initial \
  --mode acl-enabled \
  --namespace "$run_suffix" \
  --base-url http://cognee:8000 \
  --state /contract-output/positive-state.json \
  --output /contract-output/positive-initial.json \
  | tee "$output_dir/positive-initial.log"

docker logs "$positive" >"$output_dir/acl-enabled-before-restart.log" 2>&1
docker rm -f "$positive" >/dev/null
current_case="acl_enabled_restart_recovery_and_deletion"
_start_cognee "$positive" "$positive_volume" true true
docker exec "$positive" python /contract/provider_contract.py \
  --phase recovery \
  --mode acl-enabled \
  --namespace "$run_suffix" \
  --base-url http://cognee:8000 \
  --state /contract-output/positive-state.json \
  --output /contract-output/positive-recovery.json \
  | tee "$output_dir/positive-recovery.log"

current_case="machine_readable_evidence_receipt"
python3 "$fixture_dir/evidence_summary.py" \
  --image "$image" \
  --image-inspect "$output_dir/image-inspect.json" \
  --source "$output_dir/source-evidence.json" \
  --negative "$output_dir/negative-control.json" \
  --positive-initial "$output_dir/positive-initial.json" \
  --positive "$output_dir/positive-recovery.json" \
  --stub-log "$output_dir/stub-requests.jsonl" \
  --drop-log "$output_dir/commit-then-drop.jsonl" \
  --expected-drop-path /api/v1/add \
  --output "$output_dir/evidence.json" \
  | tee "$output_dir/evidence-summary.log"

echo "Cognee memory provider contract: PASS"
