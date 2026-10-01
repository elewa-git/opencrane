#!/usr/bin/env bash
set -euo pipefail

set +x

ROOT_DIR="${1:?repository root is required}"
RUN_DIR="${2:?run directory is required}"
NAMESPACE="${3:?namespace is required}"
RELEASE_NAME="${4:?release name is required}"
CONTROL_PLANE_HOST="${5:?control-plane host is required}"
TIMEOUT_SECONDS="${6:?timeout is required}"
CLUSTER_NAME="${7:?disposable cluster name is required}"
STATE_FILE="$RUN_DIR/hosted-services.env"
ARCHIVE_EVIDENCE="$RUN_DIR/oci-archive-evidence.json"
PREREQUISITES_PATH="${HOSTED_GENERATED_FILE_PREREQUISITES_PATH:-$RUN_DIR/prerequisites.json}"
CLIENT_CA_BUNDLE="$RUN_DIR/client-ca-bundle.crt"
LOCAL_DATABASE_PORT="55433"
EXPECTED_CONTEXT="k3d-${CLUSTER_NAME}"
POSTGRES_RELEASE="${RELEASE_NAME}-postgres"
POOLER_SERVICE="${POSTGRES_RELEASE}-pooler"
APPLICATION_SECRET="${POSTGRES_RELEASE}-opencrane-app"
PORT_FORWARD_PID=""
PORT_FORWARD_LOG=""
OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL=""

_error()
{
  printf '[hosted-qualification] %s\n' "$1" >&2
}

_cleanup()
{
  local status=$?
  unset OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
    wait "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$PORT_FORWARD_LOG" ]]; then
    rm -f -- "$PORT_FORWARD_LOG"
  fi
  rm -f -- "$CLIENT_CA_BUNDLE"
  return "$status"
}

_require_command()
{
  command -v "$1" >/dev/null 2>&1 || { _error "Missing required command '$1'"; exit 1; }
}

_require_deployed_release()
{
  local release="$1" chart="$2" status metadata expected_version
  expected_version="$(jq -r '.version' "$ROOT_DIR/package.json")"
  status="$(helm status "$release" --kube-context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" --output json)"
  metadata="$(helm get metadata "$release" --kube-context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" --output json)"
  [[ "$(jq -r '.info.status' <<<"$status")" == "deployed" ]] || { _error "Release '$release' is not deployed"; exit 1; }
  [[ "$(jq -r '.chart' <<<"$metadata")" == "$chart" && "$(jq -r '.version' <<<"$metadata")" == "$expected_version" ]] || {
    _error "Release '$release' is not the current qualification version"
    exit 1
  }
}

_assert_disposable_database_owner()
{
  [[ "$(kubectl get service "$POOLER_SERVICE" --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.cnpg\.io/cluster}')" == "$POSTGRES_RELEASE" ]] || {
    _error "Pooler service does not belong to PostgreSQL release '$POSTGRES_RELEASE'"
    exit 1
  }
}

_assert_deployment_owner()
{
  local deployment="$1" deployment_namespace="$2" component="$3"
  local instance managed_by release_name release_namespace
  instance="$(kubectl get deployment "$deployment" --context "$EXPECTED_CONTEXT" --namespace "$deployment_namespace" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/instance}')"
  managed_by="$(kubectl get deployment "$deployment" --context "$EXPECTED_CONTEXT" --namespace "$deployment_namespace" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  release_name="$(kubectl get deployment "$deployment" --context "$EXPECTED_CONTEXT" --namespace "$deployment_namespace" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}')"
  release_namespace="$(kubectl get deployment "$deployment" --context "$EXPECTED_CONTEXT" --namespace "$deployment_namespace" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-namespace}')"
  [[ "$instance" == "$RELEASE_NAME" && "$managed_by" == "Helm" && "$release_name" == "$RELEASE_NAME" && "$release_namespace" == "$NAMESPACE" ]] || {
    _error "Deployment '$deployment' is not owned by release '$RELEASE_NAME'"
    exit 1
  }
  [[ "$(kubectl get deployment "$deployment" --context "$EXPECTED_CONTEXT" --namespace "$deployment_namespace" -o jsonpath='{.spec.template.metadata.labels.app\.kubernetes\.io/component}')" == "$component" ]] || {
    _error "Deployment '$deployment' does not identify as component '$component'"
    exit 1
  }
}

_restart_owned_workloads()
{
  local server_deployment="${RELEASE_NAME}-opencrane-server"
  local artifact_deployment="${RELEASE_NAME}-artifact-service"
  local artifact_namespace="${RELEASE_NAME}-artifacts"
  local server_pods artifact_pods
  _assert_deployment_owner "$server_deployment" "$NAMESPACE" "opencrane-server"
  _assert_deployment_owner "$artifact_deployment" "$artifact_namespace" "artifact-service"
  server_pods="$(_owned_pod_ids "$NAMESPACE" "opencrane-server")"
  artifact_pods="$(_owned_pod_ids "$artifact_namespace" "artifact-service")"
  kubectl rollout restart "deployment/${server_deployment}" --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE"
  kubectl rollout restart "deployment/${artifact_deployment}" --context "$EXPECTED_CONTEXT" --namespace "$artifact_namespace"
  kubectl rollout status "deployment/${server_deployment}" --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  kubectl rollout status "deployment/${artifact_deployment}" --context "$EXPECTED_CONTEXT" --namespace "$artifact_namespace" --timeout="${TIMEOUT_SECONDS}s"
  _wait_for_prior_pods_to_exit "$NAMESPACE" "opencrane-server" "$server_pods"
  _wait_for_prior_pods_to_exit "$artifact_namespace" "artifact-service" "$artifact_pods"
}

_owned_pod_ids()
{
  local pod_namespace="$1" component="$2" pod_ids
  pod_ids="$(kubectl get pods --context "$EXPECTED_CONTEXT" --namespace "$pod_namespace" --selector "app.kubernetes.io/instance=${RELEASE_NAME},app.kubernetes.io/component=${component}" -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}')"
  [[ -n "$pod_ids" ]] || { _error "No '$component' pods exist before restart"; exit 1; }
  printf '%s\n' "$pod_ids"
}

_wait_for_prior_pods_to_exit()
{
  local pod_namespace="$1" component="$2" prior_pods="$3" current_pods prior_pod any_prior_pod
  for (( _attempt = 1; _attempt <= TIMEOUT_SECONDS; _attempt += 1 )); do
    current_pods="$(kubectl get pods --context "$EXPECTED_CONTEXT" --namespace "$pod_namespace" --selector "app.kubernetes.io/instance=${RELEASE_NAME},app.kubernetes.io/component=${component}" -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}')"
    any_prior_pod="0"
    while IFS= read -r prior_pod; do
      if [[ -n "$prior_pod" ]] && grep -Fxq "$prior_pod" <<<"$current_pods"; then
        any_prior_pod="1"
        break
      fi
    done <<< "$prior_pods"
    if [[ "$any_prior_pod" == "0" ]]; then
      return
    fi
    sleep 1
  done
  _error "Prior '$component' pods did not exit after restart"
  exit 1
}

_assert_local_database_port()
{
  if ! node -e 'const net = require("node:net"); const server = net.createServer(); server.once("error", () => process.exit(1)); server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());' "$LOCAL_DATABASE_PORT"; then
    _error "Local qualification database port is unavailable"
    exit 1
  fi
}

_start_database_forward()
{
  PORT_FORWARD_LOG="$(mktemp)"
  kubectl port-forward --address 127.0.0.1 --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" "service/${POOLER_SERVICE}" "${LOCAL_DATABASE_PORT}:5432" >"$PORT_FORWARD_LOG" 2>&1 &
  PORT_FORWARD_PID=$!
  for _attempt in {1..50}; do
    if grep -Fq "Forwarding from 127.0.0.1:${LOCAL_DATABASE_PORT}" "$PORT_FORWARD_LOG"; then
      return
    fi
    kill -0 "$PORT_FORWARD_PID" >/dev/null 2>&1 || { _error "Database port-forward stopped before readiness"; exit 1; }
    sleep 0.1
  done
  _error "Database port-forward did not become ready"
  exit 1
}

_load_database_url()
{
  local raw_database_url
  raw_database_url="$(kubectl get secret "$APPLICATION_SECRET" --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" -o jsonpath='{.data.uri}' | base64 -d)"
  [[ -n "$raw_database_url" ]] || { _error "Disposable application database credential is unavailable"; exit 1; }
  OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL="$(RAW_DATABASE_URL="$raw_database_url" LOCAL_DATABASE_PORT="$LOCAL_DATABASE_PORT" node -e '
    const url = new URL(process.env.RAW_DATABASE_URL);
    url.hostname = "127.0.0.1";
    url.port = process.env.LOCAL_DATABASE_PORT;
    process.stdout.write(url.toString());
  ')"
  unset raw_database_url
}

_run_cli()
{
  local command="$1"
  local -a environment
  environment=(
    "NODE_EXTRA_CA_CERTS=$CLIENT_CA_BUNDLE"
    "OPENCRANE_HOSTED_QUALIFICATION_BASE_URL=https://${CONTROL_PLANE_HOST}:8443"
    "OPENCRANE_HOSTED_QUALIFICATION_BASE_TRANSPORT_ADDRESS=127.0.0.1"
    "OPENCRANE_HOSTED_QUALIFICATION_OIDC_TRANSPORT_BASE_URL=$HOSTED_PROTOCOL_TRANSPORT_URL"
    "OPENCRANE_HOSTED_QUALIFICATION_OCI_LAYOUT_ZIP_PATH=$(jq -r '.archivePath' "$ARCHIVE_EVIDENCE")"
    "OPENCRANE_HOSTED_QUALIFICATION_EXPECTED_CSV_PATH=$(jq -r '.expectedCsvPath' "$ARCHIVE_EVIDENCE")"
    "OPENCRANE_HOSTED_QUALIFICATION_OIDC_SUBJECT=$HOSTED_OIDC_SUBJECT"
    "OPENCRANE_HOSTED_QUALIFICATION_OIDC_EMAIL=$HOSTED_OIDC_EMAIL"
    "OPENCRANE_HOSTED_QUALIFICATION_OWNER_OIDC_SUBJECT=$HOSTED_OWNER_OIDC_SUBJECT"
    "OPENCRANE_HOSTED_QUALIFICATION_OWNER_OIDC_EMAIL=$HOSTED_OWNER_OIDC_EMAIL"
    "OPENCRANE_HOSTED_QUALIFICATION_OIDC_ISSUER=$HOSTED_PROTOCOL_URL"
    "OPENCRANE_HOSTED_QUALIFICATION_NAMESPACE=$NAMESPACE"
    "OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=$OPENCRANE_HOSTED_QUALIFICATION_SILO_ID"
    "OPENCRANE_HOSTED_QUALIFICATION_EVIDENCE_PATH=$HOSTED_EVIDENCE_PATH"
    "OPENCRANE_HOSTED_QUALIFICATION_PREREQUISITES_PATH=$PREREQUISITES_PATH"
    "OPENCRANE_HOSTED_QUALIFICATION_TIMEOUT_MS=$((TIMEOUT_SECONDS * 1000))"
  )
  if [[ "$command" == "prepare" || "$command" == "qualify" ]]; then
    environment+=("OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL=$OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL")
  fi
  env "${environment[@]}" node "$ROOT_DIR/dist/apps/opencrane/hosted-generated-file/hosted-generated-file-cli.js" "$command"
}

trap _cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -f "$STATE_FILE" && -f "$ARCHIVE_EVIDENCE" ]] || { _error "Fixture state and OCI archive evidence are required"; exit 1; }
[[ -n "${OPENCRANE_HOSTED_QUALIFICATION_SILO_ID:-}" ]] || { _error "OPENCRANE_HOSTED_QUALIFICATION_SILO_ID is required"; exit 2; }
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] && (( TIMEOUT_SECONDS <= 1800 )) || { _error "Timeout must be a positive integer no greater than 1800 seconds"; exit 2; }
[[ "$CLUSTER_NAME" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { _error "Disposable cluster name must be a DNS label"; exit 2; }
for command in base64 curl helm jq kubectl node openssl; do _require_command "$command"; done

# The fixture helper is the sole writer of this state file and quotes each generated value.
# shellcheck disable=SC1090
source "$STATE_FILE"
[[ -n "${HOSTED_OWNER_OIDC_SUBJECT:-}" && -n "${HOSTED_OWNER_OIDC_EMAIL:-}" ]] || { _error "Fixture owner OIDC identity is required"; exit 1; }
[[ "$(kubectl config current-context)" == "$EXPECTED_CONTEXT" ]] || { _error "Current context does not match disposable cluster '$EXPECTED_CONTEXT'"; exit 1; }
_require_deployed_release "$RELEASE_NAME" "opencrane-silo"
_require_deployed_release "$POSTGRES_RELEASE" "postgres"
_assert_disposable_database_owner
_assert_local_database_port
_start_database_forward
_load_database_url

# The control-plane certificate stays dependent on the existing fixture CA contract.
cp "$HOSTED_CA_PATH" "$CLIENT_CA_BUNDLE"
kubectl get secret "${RELEASE_NAME}-clustertenant-tls" --context "$EXPECTED_CONTEXT" --namespace "$NAMESPACE" \
  -o jsonpath='{.data.tls\.crt}' | openssl base64 -d -A >> "$CLIENT_CA_BUNDLE"

_run_cli prepare
_run_cli validate
_run_cli qualify
_restart_owned_workloads
_run_cli verify

curl --fail --silent --show-error --cacert "$HOSTED_CA_PATH" \
  --header "Authorization: Bearer $(<"$HOSTED_EVIDENCE_KEY_PATH")" \
  "$HOSTED_PROTOCOL_TRANSPORT_URL/__fixture/evidence" > "$RUN_DIR/evidence/protocol.json"
jq -e '
  .modelRequestCount == 2
  and .toolResponseCount == 1
  and .continuationResponseCount == 1
' "$RUN_DIR/evidence/protocol.json" >/dev/null || {
  _error "Protocol fixture model-call ledger did not match the governed initial turn and replay"
  exit 1
}
