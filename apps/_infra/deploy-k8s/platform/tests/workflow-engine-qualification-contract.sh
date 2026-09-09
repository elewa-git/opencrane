#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
QUALIFIER_SOURCE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/qualify-workflow-engine.sh"
TEST_DIR="$(mktemp -d)"
MOCK_BIN="$TEST_DIR/bin"
CAPTURE="$TEST_DIR/capture"
mkdir -p "$MOCK_BIN"
trap 'rm -rf -- "$TEST_DIR"' EXIT
RUNNER_ROOT="$TEST_DIR/repository"
QUALIFIER="$RUNNER_ROOT/apps/_infra/deploy-k8s/platform/qualify-workflow-engine.sh"
mkdir -p "$RUNNER_ROOT/apps/_infra/deploy-k8s/platform" "$RUNNER_ROOT/libs/backend/server/infra/workflows/infra_absurd" "$RUNNER_ROOT/node_modules/.bin"
ln -s "$QUALIFIER_SOURCE" "$QUALIFIER"
ln -s "$ROOT_DIR/releases" "$RUNNER_ROOT/releases"
ln -s "$ROOT_DIR/package.json" "$RUNNER_ROOT/package.json"

cat >"$MOCK_BIN/helm" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "status" ]]; then
  printf '%s\n' '{"info":{"status":"deployed"}}'
  exit 0
fi
if [[ "$1" == "get" && "$2" == "metadata" && "$3" == "opencrane-testlynn-postgres" ]]; then
  printf '%s\n' '{"chart":"postgres","version":"0.11.0"}'
  exit 0
fi
if [[ "$1" == "get" && "$2" == "metadata" && "$3" == "opencrane-testlynn" ]]; then
  printf '{"chart":"opencrane-silo","version":"%s"}\n' "${MOCK_SILO_VERSION:-0.11.0}"
  exit 0
fi
exit 1
EOF

cat >"$MOCK_BIN/kubectl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == "config current-context" ]]; then printf '%s\n' 'gke_opencrane-dev'; exit 0; fi
if [[ "$*" == *"get service"* ]]; then printf '%s' 'opencrane-testlynn-postgres'; exit 0; fi
if [[ "$*" == *"get secret"* ]]; then printf '%s' 'cG9zdGdyZXNxbDovL29wZW5jcmFuZTpzdXBlci1zZWNyZXRAaW50ZXJuYWw6NTQzMi9vcGVuY3JhbmU='; exit 0; fi
if [[ "$*" == *"port-forward"* ]]; then
  printf '%s\n' 'Forwarding from 127.0.0.1:65431 -> 5432'
  while true; do sleep 1; done
fi
exit 1
EOF

cat >"$RUNNER_ROOT/node_modules/.bin/tsx" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == "src/qualification/qualify-workflow-engine.cli.ts" ]]
[[ "$PWD" == */libs/backend/server/infra/workflows/infra_absurd ]]
[[ "$DATABASE_URL" == 'postgresql://opencrane:super-secret@127.0.0.1:65431/opencrane' ]]
[[ "$OPENCRANE_WORKFLOW_ENGINE_SILO_ID" == 'testlynn' ]]
[[ "$OPENCRANE_WORKFLOW_ENGINE_SAMPLE_COUNT" == '40' ]]
[[ "$OPENCRANE_WORKFLOW_ENGINE_POLL_INTERVAL_MS" == '50' ]]
[[ "$OPENCRANE_WORKFLOW_ENGINE_THRESHOLD_MS" == '250' ]]
[[ "$OPENCRANE_WORKFLOW_ENGINE_DATABASE_POOL_SIZE" == '2' ]]
printf '%s\n' 'Workflow engine qualification started.' >&2
printf '%s\n' '{"passed":true,"sampleCount":40,"warmupCount":5,"pollIntervalMs":50,"thresholdMs":250,"databasePoolSize":2,"connectionCeiling":3,"transport":"kubectl-port-forward","latencyMs":{"p50":100,"p95":120,"p99":140,"max":140},"connectionEvidence":{"available":true,"peakConnections":2}}'
EOF

cat >"$MOCK_BIN/node" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"net.createServer"* ]]; then exit 0; fi
[[ "$RAW_DATABASE_URL" == 'postgresql://opencrane:super-secret@internal:5432/opencrane' ]]
[[ "$LOCAL_PORT" == '65431' ]]
printf '%s' 'postgresql://opencrane:super-secret@127.0.0.1:65431/opencrane'
EOF

chmod +x "$MOCK_BIN/helm" "$MOCK_BIN/kubectl" "$MOCK_BIN/node" "$RUNNER_ROOT/node_modules/.bin/tsx"
PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 >"$CAPTURE"
grep -Fq '"passed":true' "$CAPTURE"
if grep -Fq 'super-secret' "$CAPTURE"; then
  printf 'workflow engine qualifier exposed the application credential\n' >&2
  exit 1
fi
if MOCK_SILO_VERSION=0.9.2 PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 >"$TEST_DIR/version-mismatch" 2>&1; then
  printf 'workflow engine qualifier accepted an out-of-date silo release\n' >&2
  exit 1
fi
grep -Fq 'silo release is not the qualification version' "$TEST_DIR/version-mismatch"
cat >"$RUNNER_ROOT/node_modules/.bin/tsx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Workflow engine qualification started.' >&2
printf '%s\n' '{"passed":true,"latencyMs":{"p50":100,"p95":120},"connectionEvidence":{"available":true}}'
EOF
chmod +x "$RUNNER_ROOT/node_modules/.bin/tsx"
if PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 >"$TEST_DIR/partial-result" 2>&1; then
  printf 'workflow engine qualifier accepted a partial result\n' >&2
  exit 1
fi
grep -Fq 'qualifier did not emit a complete result' "$TEST_DIR/partial-result"
cat >"$RUNNER_ROOT/node_modules/.bin/tsx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Workflow engine qualification started.' >&2
exit 0
EOF
chmod +x "$RUNNER_ROOT/node_modules/.bin/tsx"
if PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 >"$TEST_DIR/missing-result" 2>&1; then
  printf 'workflow engine qualifier accepted an empty result\n' >&2
  exit 1
fi
grep -Fq 'qualifier did not emit a complete result' "$TEST_DIR/missing-result"
cat >"$RUNNER_ROOT/node_modules/.bin/tsx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Workflow engine qualification started.' >&2
printf '%s\n' '{"passed":false,"sampleCount":40,"warmupCount":5,"pollIntervalMs":50,"thresholdMs":250,"databasePoolSize":2,"connectionCeiling":3,"transport":"kubectl-port-forward","latencyMs":{"p50":100,"p95":400,"p99":450,"max":450},"connectionEvidence":{"available":true,"peakConnections":2}}'
exit 2
EOF
chmod +x "$RUNNER_ROOT/node_modules/.bin/tsx"
if PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 >"$TEST_DIR/failed-result" 2>&1; then
  printf 'workflow engine qualifier accepted a failed latency result\n' >&2
  exit 1
else
  qualifier_status=$?
fi
[[ "$qualifier_status" -eq 2 ]]
grep -Fq '"passed":false' "$TEST_DIR/failed-result"
cat >"$RUNNER_ROOT/node_modules/.bin/tsx" <<'EOF'
#!/usr/bin/env bash
sleep 2
EOF
chmod +x "$RUNNER_ROOT/node_modules/.bin/tsx"
if PATH="$MOCK_BIN:$PATH" bash "$QUALIFIER" --context gke_opencrane-dev --cluster-tenant testlynn --local-port 65431 --runner-timeout-seconds 1 >"$TEST_DIR/runner-timeout" 2>&1; then
  printf 'workflow engine qualifier accepted a stalled runner\n' >&2
  exit 1
fi
grep -Fq 'qualifier runner exceeded 1s without a result' "$TEST_DIR/runner-timeout"
grep -Fq 'QUALIFICATION_RUNNER="$REPOSITORY_ROOT/node_modules/.bin/tsx"' "$QUALIFIER_SOURCE"
bash -n "$QUALIFIER_SOURCE"
echo "workflow engine qualification contract: PASS"
