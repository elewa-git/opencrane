#!/usr/bin/env bash
# Qualifies workflow-engine pickup latency through one local port-forward and the silo application credential.
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
KUBE_CONTEXT=""
CLUSTER_TENANT=""
NAMESPACE=""
LOCAL_PORT="55432"
SAMPLE_COUNT="40"
POLL_INTERVAL_MS="50"
THRESHOLD_MS="250"
DATABASE_POOL_SIZE="2"
RUNNER_TIMEOUT_SECONDS="300"
PORT_FORWARD_PID=""
PORT_FORWARD_LOG=""
QUALIFICATION_OUTPUT=""
QUALIFICATION_ERROR=""
QUALIFICATION_PID=""

_error()
{
  printf 'workflow engine qualification: %s\n' "$1" >&2
}

_cleanup()
{
  local status=$?
  unset DATABASE_URL
  if [[ -n "$QUALIFICATION_PID" ]]; then
    kill "$QUALIFICATION_PID" >/dev/null 2>&1 || true
    wait "$QUALIFICATION_PID" >/dev/null 2>&1 || true
    QUALIFICATION_PID=""
  fi
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
    wait "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$PORT_FORWARD_LOG" ]]; then
    rm -f -- "$PORT_FORWARD_LOG"
  fi
  if [[ -n "$QUALIFICATION_OUTPUT" ]]; then
    rm -f -- "$QUALIFICATION_OUTPUT"
  fi
  if [[ -n "$QUALIFICATION_ERROR" ]]; then
    rm -f -- "$QUALIFICATION_ERROR"
  fi
  return "$status"
}

trap _cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) KUBE_CONTEXT="$2"; shift 2 ;;
    --cluster-tenant) CLUSTER_TENANT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --local-port) LOCAL_PORT="$2"; shift 2 ;;
    --samples) SAMPLE_COUNT="$2"; shift 2 ;;
    --poll-interval-ms) POLL_INTERVAL_MS="$2"; shift 2 ;;
    --threshold-ms) THRESHOLD_MS="$2"; shift 2 ;;
    --database-pool-size) DATABASE_POOL_SIZE="$2"; shift 2 ;;
    --runner-timeout-seconds) RUNNER_TIMEOUT_SECONDS="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) _error "unknown flag '$1'"; exit 2 ;;
  esac
done

[[ "$KUBE_CONTEXT" =~ ^[A-Za-z0-9._:/-]+$ ]] || { _error "--context is required and must be exact"; exit 2; }
[[ "$CLUSTER_TENANT" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { _error "--cluster-tenant must be a DNS label"; exit 2; }
[[ -n "$NAMESPACE" ]] || NAMESPACE="opencrane-${CLUSTER_TENANT}"
[[ "$NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { _error "--namespace must be a DNS label"; exit 2; }
for bounded_integer in "$LOCAL_PORT" "$SAMPLE_COUNT" "$POLL_INTERVAL_MS" "$THRESHOLD_MS" "$DATABASE_POOL_SIZE" "$RUNNER_TIMEOUT_SECONDS"; do
  [[ "$bounded_integer" =~ ^[1-9][0-9]*$ ]] || { _error "numeric inputs must be positive integers"; exit 2; }
done
(( LOCAL_PORT >= 1024 && LOCAL_PORT <= 65535 )) || { _error "--local-port must be from 1024 through 65535"; exit 2; }
(( RUNNER_TIMEOUT_SECONDS <= 900 )) || { _error "--runner-timeout-seconds must not exceed 900"; exit 2; }

for command in base64 helm jq kubectl node; do
  command -v "$command" >/dev/null 2>&1 || { _error "missing required command '$command'"; exit 1; }
done
QUALIFICATION_RUNNER="$REPOSITORY_ROOT/node_modules/.bin/tsx"
[[ -x "$QUALIFICATION_RUNNER" ]] || { _error "qualification runner is unavailable"; exit 1; }

CURRENT_CONTEXT="$(kubectl config current-context)"
[[ "$CURRENT_CONTEXT" == "$KUBE_CONTEXT" ]] || { _error "current context does not match --context"; exit 1; }
RELEASE="opencrane-${CLUSTER_TENANT}"
POSTGRES_RELEASE="${RELEASE}-postgres"
POOLER_SERVICE="${POSTGRES_RELEASE}-pooler"
APPLICATION_SECRET="${POSTGRES_RELEASE}-opencrane-app"
EXPECTED_VERSION="$(jq -r '.repositoryVersion' "$REPOSITORY_ROOT/releases/0.10.0.json")"

SILO_STATUS="$(helm status "$RELEASE" --namespace "$NAMESPACE" --output json)"
POSTGRES_STATUS="$(helm status "$POSTGRES_RELEASE" --namespace "$NAMESPACE" --output json)"
SILO_METADATA="$(helm get metadata "$RELEASE" --namespace "$NAMESPACE" --output json)"
POSTGRES_METADATA="$(helm get metadata "$POSTGRES_RELEASE" --namespace "$NAMESPACE" --output json)"
[[ "$(jq -r '.info.status' <<<"$SILO_STATUS")" == "deployed" ]] || { _error "silo release is not deployed"; exit 1; }
[[ "$(jq -r '.chart' <<<"$SILO_METADATA")" == "opencrane-silo" && "$(jq -r '.version' <<<"$SILO_METADATA")" == "$EXPECTED_VERSION" ]] || { _error "silo release is not the qualification version"; exit 1; }
[[ "$(jq -r '.info.status' <<<"$POSTGRES_STATUS")" == "deployed" ]] || { _error "PostgreSQL release is not deployed"; exit 1; }
[[ "$(jq -r '.chart' <<<"$POSTGRES_METADATA")" == "postgres" && "$(jq -r '.version' <<<"$POSTGRES_METADATA")" == "$EXPECTED_VERSION" ]] || { _error "PostgreSQL release is not the qualification version"; exit 1; }

[[ "$(kubectl get service "$POOLER_SERVICE" --namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.cnpg\.io/cluster}')" == "$POSTGRES_RELEASE" ]] || { _error "pooler service does not belong to the named silo"; exit 1; }
kubectl get secret "$APPLICATION_SECRET" --namespace "$NAMESPACE" -o jsonpath='{.data.uri}' | grep -q . || { _error "application database credential is unavailable"; exit 1; }

if ! node -e 'const net = require("node:net"); const server = net.createServer(); server.once("error", () => process.exit(1)); server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());' "$LOCAL_PORT"; then
  _error "local qualification port is unavailable"
  exit 1
fi

PORT_FORWARD_LOG="$(mktemp)"
kubectl port-forward --context "$KUBE_CONTEXT" --namespace "$NAMESPACE" "service/${POOLER_SERVICE}" "${LOCAL_PORT}:5432" >"$PORT_FORWARD_LOG" 2>&1 &
PORT_FORWARD_PID=$!
for _attempt in {1..50}; do
  if grep -Fq "Forwarding from 127.0.0.1:${LOCAL_PORT}" "$PORT_FORWARD_LOG"; then break; fi
  kill -0 "$PORT_FORWARD_PID" >/dev/null 2>&1 || { _error "database port-forward stopped before readiness"; exit 1; }
  sleep 0.1
done
grep -Fq "Forwarding from 127.0.0.1:${LOCAL_PORT}" "$PORT_FORWARD_LOG" || { _error "database port-forward did not become ready"; exit 1; }

RAW_DATABASE_URL="$(kubectl get secret "$APPLICATION_SECRET" --namespace "$NAMESPACE" -o jsonpath='{.data.uri}' | base64 -d)"
DATABASE_URL="$(RAW_DATABASE_URL="$RAW_DATABASE_URL" LOCAL_PORT="$LOCAL_PORT" node -e '
  const url = new URL(process.env.RAW_DATABASE_URL);
  url.hostname = "127.0.0.1";
  url.port = process.env.LOCAL_PORT;
  process.stdout.write(url.toString());
')"
unset RAW_DATABASE_URL
export DATABASE_URL
export OPENCRANE_WORKFLOW_ENGINE_SILO_ID="$CLUSTER_TENANT"
export OPENCRANE_WORKFLOW_ENGINE_SAMPLE_COUNT="$SAMPLE_COUNT"
export OPENCRANE_WORKFLOW_ENGINE_POLL_INTERVAL_MS="$POLL_INTERVAL_MS"
export OPENCRANE_WORKFLOW_ENGINE_THRESHOLD_MS="$THRESHOLD_MS"
export OPENCRANE_WORKFLOW_ENGINE_DATABASE_POOL_SIZE="$DATABASE_POOL_SIZE"

QUALIFICATION_OUTPUT="$(mktemp)"
QUALIFICATION_ERROR="$(mktemp)"
(
  cd "$REPOSITORY_ROOT/libs/backend/server/infra/workflows/infra_absurd"
  "$QUALIFICATION_RUNNER" src/qualification/qualify-workflow-engine.cli.ts
) >"$QUALIFICATION_OUTPUT" 2>"$QUALIFICATION_ERROR" &
QUALIFICATION_PID=$!
_error "starting qualifier runner"
QUALIFICATION_STATUS=0
for (( attempt = 1; attempt <= RUNNER_TIMEOUT_SECONDS; attempt += 1 )); do
  if ! kill -0 "$QUALIFICATION_PID" >/dev/null 2>&1; then
    wait "$QUALIFICATION_PID" || QUALIFICATION_STATUS=$?
    QUALIFICATION_PID=""
    break
  fi
  sleep 1
done
if [[ -n "$QUALIFICATION_PID" ]]; then
  kill "$QUALIFICATION_PID" >/dev/null 2>&1 || true
  wait "$QUALIFICATION_PID" >/dev/null 2>&1 || true
  QUALIFICATION_PID=""
  _error "qualifier runner exceeded ${RUNNER_TIMEOUT_SECONDS}s without a result"
  exit 1
fi
if ! grep -Fxq "Workflow engine qualification started." "$QUALIFICATION_ERROR"; then
  _error "qualifier runner exited before it reported startup"
  exit 1
fi
QUALIFICATION_RESULT="$(<"$QUALIFICATION_OUTPUT")"
jq -e '
  type == "object"
  and (.passed | type == "boolean")
  and (.sampleCount | type == "number")
  and (.warmupCount | type == "number")
  and (.pollIntervalMs | type == "number")
  and (.thresholdMs | type == "number")
  and (.databasePoolSize | type == "number")
  and (.connectionCeiling | type == "number")
  and (.transport == "kubectl-port-forward")
  and (.latencyMs | type == "object")
  and (.latencyMs.p50 | type == "number")
  and (.latencyMs.p95 | type == "number")
  and (.latencyMs.p99 | type == "number")
  and (.latencyMs.max | type == "number")
  and (.connectionEvidence | type == "object")
  and (.connectionEvidence.available | type == "boolean")
  and (if .connectionEvidence.available then (.connectionEvidence.peakConnections | type == "number") else (.connectionEvidence | has("peakConnections") | not) end)
' <<<"$QUALIFICATION_RESULT" >/dev/null || { _error "qualifier did not emit a complete result"; exit 1; }
printf '%s\n' "$QUALIFICATION_RESULT"
exit "$QUALIFICATION_STATUS"
