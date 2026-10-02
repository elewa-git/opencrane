#!/usr/bin/env bash
# Proves a fresh install requests only the application databases that remain in the target baseline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TIMEOUT=60
POSTGRES_RELEASE=opencrane-test
POSTGRES_CHART_DIR=/charts/postgres
NAMESPACE=opencrane-test
POSTGRES_OPERAND_IMAGE=postgres@sha256:test
POSTGRES_OWNER=opencrane
POSTGRES_CREDENTIALS_SECRET=opencrane-postgres
LITELLM_POSTGRES_OWNER=litellm
LITELLM_POSTGRES_CREDENTIALS_SECRET=litellm-postgres
POSTGRES_ADMIN_NAME=postgres
POSTGRES_ADMIN_CREDENTIALS_SECRET=postgres-admin
POSTGRES_BOOTSTRAP_BASELINE_SHA256=baseline-digest
POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP=target-baseline
POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY=target-baseline.sql
POSTGRES_VALUES_FILE=""
STORAGE_CLASS=""
POSTGRES_KUBERNETES_API_ARGS=(--kubeconfig /tmp/opencrane-release-test-kubeconfig)
KUBECTL_CALLS=()
POOLER_GET_ATTEMPTS_FILE="$(mktemp)"
POOLER_GET_CALLS_FILE="$(mktemp)"
POOLER_GET_ERROR_FILE="$(mktemp)"
POOLER_GET_TIMEOUT_FILE="$(mktemp)"
POOLER_GET_STALL_FILE="$(mktemp)"
printf '0' >"$POOLER_GET_ATTEMPTS_FILE"
POOLER_GET_MODE=success
trap 'rm -f "$POOLER_GET_ATTEMPTS_FILE" "$POOLER_GET_CALLS_FILE" "$POOLER_GET_ERROR_FILE" "$POOLER_GET_TIMEOUT_FILE" "$POOLER_GET_STALL_FILE"' EXIT

helm()
{
  [[ "$1" == "status" ]] && return 1
  return 0
}

kubectl()
{
  local argument
  local pooler_get_attempts
  local request_timeout_seconds
  KUBECTL_CALLS+=("$*")
  if [[ "$1" == get && "$2" == "deployment/${POSTGRES_RELEASE}-pooler" ]]; then
    printf '%s\n' "$*" >>"$POOLER_GET_CALLS_FILE"
    pooler_get_attempts="$(( $(<"$POOLER_GET_ATTEMPTS_FILE") + 1 ))"
    printf '%s' "$pooler_get_attempts" >"$POOLER_GET_ATTEMPTS_FILE"
    if [[ "$POOLER_GET_MODE" == error ]]; then
      return 42
    elif [[ "$POOLER_GET_MODE" == stall ]]; then
      for argument in "$@"; do
        if [[ "$argument" == --request-timeout=*s ]]; then
          request_timeout_seconds="${argument#--request-timeout=}"
          request_timeout_seconds="${request_timeout_seconds%s}"
        fi
      done
      [[ -n "$request_timeout_seconds" ]]
      command sleep "$request_timeout_seconds"
      return 28
    elif [[ "$POOLER_GET_MODE" == success ]] && (( pooler_get_attempts >= 2 )); then
      printf 'deployment.apps/%s-pooler\n' "$POSTGRES_RELEASE"
    fi
    return 0
  fi
}

sleep()
{
  :
}

log()
{
  :
}

err()
{
  printf '%s\n' "$*" >&2
}

# shellcheck source=../postgres-release.sh
source "$SCRIPT_DIR/../postgres-release.sh"

build_postgres_release_args false
rendered_args="$(printf '%s\n' "${POSTGRES_ARGS[@]}")"

expected_databases='databases=[{"name":"opencrane","owner":"opencrane","credentialsSecret":"opencrane-postgres"},{"name":"litellm","owner":"litellm","credentialsSecret":"litellm-postgres"}]'
expected_selectors='pooler.clientPodSelectors=[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"agent-controller"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}}]'
[[ "$rendered_args" == *"$expected_databases"* ]]
[[ "$rendered_args" == *"$expected_selectors"* ]]

install_postgres_release false
rendered_waits="$(printf '%s\n' "${KUBECTL_CALLS[@]}")"
[[ "$(<"$POOLER_GET_ATTEMPTS_FILE")" == 2 ]]
grep -Eq -- '--request-timeout=[1-9][0-9]*s' "$POOLER_GET_CALLS_FILE"
if [[ "$rendered_waits" == *"--for=create"* ]]; then
  echo "fresh PostgreSQL release must not require kubectl's version-specific create condition" >&2
  exit 1
fi
[[ "$rendered_waits" == *"database/${POSTGRES_RELEASE}-litellm"* ]]
if [[ "$rendered_waits" == *"database/${POSTGRES_RELEASE}-obot"* ]]; then
  echo "fresh PostgreSQL release must not wait for the retired Obot database" >&2
  exit 1
fi

POOLER_GET_MODE=error
if wait_for_postgres_resource_creation "deployment/${POSTGRES_RELEASE}-pooler" \
  'pooler was not created' 2>"$POOLER_GET_ERROR_FILE"; then
  echo 'pooler creation wait accepted an API error' >&2
  exit 1
else
  command_status=$?
fi
[[ "$command_status" == 42 ]]
grep -Fq 'Unable to inspect deployment/opencrane-test-pooler' "$POOLER_GET_ERROR_FILE"

POOLER_GET_MODE=missing
TIMEOUT=1
sleep() { command sleep "$@"; }
if wait_for_postgres_resource_creation "deployment/${POSTGRES_RELEASE}-pooler" \
  'pooler was not created' 2>"$POOLER_GET_TIMEOUT_FILE"; then
  echo 'pooler creation wait accepted a resource that never appeared' >&2
  exit 1
else
  command_status=$?
fi
[[ "$command_status" == 1 ]]
grep -Fq 'pooler was not created' "$POOLER_GET_TIMEOUT_FILE"

POOLER_GET_MODE=stall
TIMEOUT=1
stall_started_at="$SECONDS"
if wait_for_postgres_resource_creation "deployment/${POSTGRES_RELEASE}-pooler" \
  'pooler was not created' 2>"$POOLER_GET_STALL_FILE"; then
  echo 'pooler creation wait accepted a stalled API request' >&2
  exit 1
else
  command_status=$?
fi
stall_elapsed="$((SECONDS - stall_started_at))"
[[ "$command_status" == 28 ]]
(( stall_elapsed <= TIMEOUT + 1 ))
grep -Fq 'Unable to inspect deployment/opencrane-test-pooler' "$POOLER_GET_STALL_FILE"

echo "postgres release contract: PASS"
