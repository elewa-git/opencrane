#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly root_dir="$(git rev-parse --show-toplevel)"
readonly fixture_dir="$root_dir/apps/_infra/cognee/tests/fixtures"
readonly candidate_dir="$root_dir/apps/_infra/cognee/tests/candidates/1.5.4"
readonly default_output_dir="$root_dir/.nx/test-results/cognee-memory-contract-1-5-4"
readonly requested_output_dir="${OUTPUT_DIR:-$default_output_dir}"
mkdir -p "$requested_output_dir"
readonly output_dir="$(cd "$requested_output_dir" && pwd)"
readonly image="${COGNEE_CANDIDATE_IMAGE:-opencrane-cognee:memory-contract-1-5-4}"
readonly run_suffix="${GITHUB_RUN_ID:-local}-$$-$RANDOM"
readonly prefix="opencrane-memory-1-5-4-$run_suffix"
readonly network="$prefix"
readonly stub="$prefix-stub"
readonly proxy="$prefix-drop"
readonly negative="$prefix-negative"
readonly positive="$prefix-positive"
readonly copier="$prefix-output-copy"
readonly negative_volume="$prefix-negative"
readonly positive_volume="$prefix-positive"
readonly output_volume="$prefix-output"
current_case="initialize"

rm -f \
  "$output_dir/evidence.json" \
  "$output_dir/image-inspect.json" \
  "$output_dir/image-smoke.json" \
  "$output_dir/source-evidence.json" \
  "$output_dir/negative-control.json" \
  "$output_dir/positive-initial.json" \
  "$output_dir/positive-deletion-restart.json" \
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

_sync_output()
{
  if ! docker volume inspect "$output_volume" >/dev/null 2>&1; then
    return
  fi
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    return
  fi
  docker rm -f "$copier" >/dev/null 2>&1 || true
  docker create \
    --name "$copier" \
    --network none \
    --mount "type=volume,source=$output_volume,target=/contract-output" \
    --entrypoint /bin/true \
    "$image" >/dev/null
  docker cp "$copier:/contract-output/." "$output_dir" >/dev/null
  docker rm -f "$copier" >/dev/null
}

_write_failure_receipt()
{
  local status="$1"
  local positive_receipt="$output_dir/positive-deletion-restart.json"
  if [[ ! -f "$positive_receipt" ]]; then
    positive_receipt="$output_dir/positive-recovery.json"
  fi
  python3 "$fixture_dir/evidence_summary.py" \
    --image "$image" \
    --image-inspect "$output_dir/image-inspect.json" \
    --source "$output_dir/source-evidence.json" \
    --negative "$output_dir/negative-control.json" \
    --positive-initial "$output_dir/positive-initial.json" \
    --positive "$positive_receipt" \
    --stub-log "$output_dir/stub-requests.jsonl" \
    --drop-log "$output_dir/commit-then-drop.jsonl" \
    --expected-drop-path /api/v1/add \
    --expected-drop-path /api/v1/cognify \
    --output "$output_dir/evidence.json" \
    --failure-status "$status" \
    --failed-case "$current_case" \
    >"$output_dir/evidence-summary.log" 2>&1
}

_cleanup()
{
  local status="$?"
  set +e
  _capture_logs
  _sync_output
  if [[ "$status" -ne 0 ]]; then
    _write_failure_receipt "$status"
  fi
  docker rm -f "$stub" "$proxy" "$negative" "$positive" "$copier" >/dev/null 2>&1 || true
  docker volume rm "$negative_volume" "$positive_volume" "$output_volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$status"
}
trap _cleanup EXIT INT TERM

command -v docker >/dev/null
current_case="docker_daemon_available"
docker info >/dev/null
current_case="candidate_image_build"
docker build \
  --platform linux/amd64 \
  --file "$candidate_dir/Dockerfile" \
  --tag "$image" \
  "$root_dir" \
  >"$output_dir/image-build.log" 2>&1
docker image inspect "$image" >"$output_dir/image-inspect.json"
current_case="candidate_image_offline_smoke"
bash "$candidate_dir/image-smoke.sh" "$image" "$output_dir/image-smoke" \
  >"$output_dir/image-smoke.log" 2>&1

read -r runtime_uid runtime_gid < <(
  docker run --rm --network none --entrypoint sh "$image" \
    -c 'printf "%s %s\n" "$(id -u)" "$(id -g)"'
)
if [[ ! "$runtime_uid" =~ ^[0-9]+$ || ! "$runtime_gid" =~ ^[0-9]+$ ]]; then
  echo "Candidate image did not expose a numeric runtime identity" >&2
  exit 1
fi
if [[ "$runtime_uid" == "0" ]]; then
  echo "Candidate provider image must run as a non-root user" >&2
  exit 1
fi

docker network create --internal "$network" >/dev/null
docker volume create "$negative_volume" >/dev/null
docker volume create "$positive_volume" >/dev/null
docker volume create "$output_volume" >/dev/null

_prepare_volume()
{
  local volume="$1"
  local target="$2"
  docker run --rm \
    --network none \
    --user 0:0 \
    --mount "type=volume,source=$volume,target=$target" \
    --entrypoint sh \
    "$image" -c "chown $runtime_uid:$runtime_gid '$target' && chmod 0700 '$target'"
}
_prepare_volume "$negative_volume" /cognee-storage
_prepare_volume "$positive_volume" /cognee-storage
_prepare_volume "$output_volume" /contract-output

docker run --rm \
  --network none \
  --mount "type=volume,source=$output_volume,target=/contract-output" \
  --entrypoint sh \
  "$image" -c \
  ': > /contract-output/stub-requests.jsonl; : > /contract-output/commit-then-drop.jsonl'

current_case="source_module_attestation"
docker run --rm \
  --network none \
  --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
  --mount "type=bind,source=$candidate_dir,target=/candidate,readonly" \
  --mount "type=volume,source=$output_volume,target=/contract-output" \
  --entrypoint python \
  "$image" /contract/source_evidence.py \
  --expected /candidate/expected-source-hashes.json \
  --profile /candidate/profile.json \
  --output /contract-output/source-evidence.json \
  | tee "$output_dir/source-evidence.log"

docker run -d \
  --name "$stub" \
  --network "$network" \
  --network-alias openai-stub \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
  --mount "type=volume,source=$output_volume,target=/contract-output" \
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
    if docker exec "$container" python -c \
      "import urllib.request; urllib.request.urlopen('$url', timeout=2).read()" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Bounded readiness failed for $container at $url" >&2
  return 1
}

_wait_for_url "$stub" "http://127.0.0.1:8090/health"

_start_cognee()
{
  local container="$1"
  local volume="$2"
  local access_control="$3"
  local require_authentication="$4"
  # This storage contract sends fixed queries, so vector search must receive them unchanged.
  docker run -d \
    --name "$container" \
    --network "$network" \
    --network-alias cognee \
    --mount "type=volume,source=$volume,target=/cognee-storage" \
    --mount "type=bind,source=$fixture_dir,target=/contract,readonly" \
    --mount "type=volume,source=$output_volume,target=/contract-output" \
    --env HOST=0.0.0.0 \
    --env PORT=8000 \
    --env "ENABLE_BACKEND_ACCESS_CONTROL=$access_control" \
    --env "REQUIRE_AUTHENTICATION=$require_authentication" \
    --env AUTO_FEEDBACK=false \
    --env HF_HUB_OFFLINE=1 \
    --env TRANSFORMERS_OFFLINE=1 \
    --env DATA_ROOT_DIRECTORY=/cognee-storage/data \
    --env SYSTEM_ROOT_DIRECTORY=/cognee-storage/system \
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
docker exec "$negative" python /contract/v1_5_4/provider_contract.py \
  --phase initial \
  --mode acl-disabled \
  --namespace "$run_suffix" \
  --state /contract-output/negative-state.json \
  --output /contract-output/negative-control.json \
  | tee "$output_dir/negative-control.log"
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
  --mount "type=volume,source=$output_volume,target=/contract-output" \
  --env UPSTREAM_HOST=cognee \
  --env UPSTREAM_PORT=8000 \
  --env DROP_METADATA_LOG=/contract-output/commit-then-drop.jsonl \
  --entrypoint python \
  "$image" /contract/commit_then_drop_proxy.py >/dev/null
_wait_for_url "$proxy" "http://127.0.0.1:8091/health"
docker exec "$positive" python /contract/v1_5_4/provider_contract.py \
  --phase initial \
  --mode acl-enabled \
  --namespace "$run_suffix" \
  --state /contract-output/positive-state.json \
  --output /contract-output/positive-initial.json \
  | tee "$output_dir/positive-initial.log"

docker rm -f "$positive" >/dev/null
current_case="acl_enabled_restart_recovery_deletion_and_faults"
_start_cognee "$positive" "$positive_volume" true true
docker exec "$positive" python /contract/v1_5_4/provider_contract.py \
  --phase recovery \
  --mode acl-enabled \
  --namespace "$run_suffix" \
  --state /contract-output/positive-state.json \
  --output /contract-output/positive-recovery.json \
  | tee "$output_dir/positive-recovery.log"

docker rm -f "$positive" >/dev/null
current_case="deletion_failure_provider_restart"
_start_cognee "$positive" "$positive_volume" true true
docker exec "$positive" python /contract/v1_5_4/provider_contract.py \
  --phase deletion-restart \
  --mode acl-enabled \
  --namespace "$run_suffix" \
  --state /contract-output/positive-state.json \
  --output /contract-output/positive-deletion-restart.json \
  | tee "$output_dir/deletion-restart.log"

current_case="machine_readable_evidence_receipt"
_sync_output
python3 "$fixture_dir/evidence_summary.py" \
  --image "$image" \
  --image-inspect "$output_dir/image-inspect.json" \
  --source "$output_dir/source-evidence.json" \
  --negative "$output_dir/negative-control.json" \
  --positive-initial "$output_dir/positive-initial.json" \
  --positive "$output_dir/positive-deletion-restart.json" \
  --stub-log "$output_dir/stub-requests.jsonl" \
  --drop-log "$output_dir/commit-then-drop.jsonl" \
  --expected-drop-path /api/v1/add \
  --expected-drop-path /api/v1/cognify \
  --output "$output_dir/evidence.json" \
  | tee "$output_dir/evidence-summary.log"

echo "Cognee 1.5.4 memory provider candidate contract: PASS"
