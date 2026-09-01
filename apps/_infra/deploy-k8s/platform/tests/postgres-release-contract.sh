#!/usr/bin/env bash
# Proves a fresh install requests only the application databases that remain in the target baseline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/../k8s-deploy.sh"

if grep -Eq 'prepare_database_release_transition|finish_database_release_transition|migrator reads this Secret' "$DEPLOY_SCRIPT"; then
  echo "deploy script must not call the retired database transition path" >&2
  exit 1
fi

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

helm()
{
  [[ "$1" == "status" ]] && return 1
  return 0
}

kubectl()
{
  KUBECTL_CALLS+=("$*")
  if [[ "$*" == "get deployment/${POSTGRES_RELEASE}-pooler -n ${NAMESPACE} --ignore-not-found -o jsonpath={.metadata.name} --request-timeout="* ]]; then
    printf '%s\n' "${POSTGRES_RELEASE}-pooler"
  fi
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
[[ "$rendered_waits" == *"database/${POSTGRES_RELEASE}-litellm"* ]]
if [[ "$rendered_waits" == *"database/${POSTGRES_RELEASE}-obot"* ]]; then
  echo "fresh PostgreSQL release must not wait for the retired Obot database" >&2
  exit 1
fi

KUBECTL_ARGUMENTS_FILE="$(mktemp)"
LAST_ERROR=""
trap 'rm -f -- "$KUBECTL_ARGUMENTS_FILE"' EXIT

err()
{
  LAST_ERROR="$*"
}

# Advance Bash's clock without delaying the contract test.
sleep()
{
  SECONDS="$((SECONDS + $1))"
}

# Return the expected name on the second request to prove that creation polling retries.
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  if [[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -ge 2 ]]; then
    printf '%s\n' 'opencrane-test-pooler'
  fi
}

TIMEOUT=3
SECONDS=0
wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 2 ]]
[[ "$(sed -n '1p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=3s" ]]
[[ "$(sed -n '2p' "$KUBECTL_ARGUMENTS_FILE")" == "get deployment/opencrane-test-pooler -n opencrane-test --ignore-not-found -o jsonpath={.metadata.name} --request-timeout=2s" ]]
[[ -z "$LAST_ERROR" ]]

# Print a warning before the expected name to prove that polling accepts normal kubectl warnings.
TIMEOUT=1
SECONDS=0
: >"$KUBECTL_ARGUMENTS_FILE"
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  printf '%s\n' 'Warning: use tokens from the TokenRequest API' >&2
  printf '%s\n' 'opencrane-test-pooler'
}

wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ -z "$LAST_ERROR" ]]

# Keep returning no resource to prove that polling stops at the shared deadline.
TIMEOUT=2
SECONDS=0
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
}

if wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"; then
  echo "creation wait accepted a resource that never appeared" >&2
  exit 1
fi
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 2 ]]
[[ "$LAST_ERROR" == "pooler was not created" ]]

# Fail one request to prove that an API error stops polling immediately.
TIMEOUT=30
SECONDS=0
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  printf '%s\n' 'Error from server (Forbidden): deployments.apps is forbidden' >&2
  return 1
}

if wait_for_postgres_resource create "deployment/opencrane-test-pooler" "pooler was not created"; then
  echo "creation wait ignored a terminal kubectl error" >&2
  exit 1
fi
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ "$LAST_ERROR" == *"kubectl get failed: Error from server (Forbidden)"* ]]

# Accept the wait command to prove that readiness checks still use kubectl wait.
TIMEOUT=2
SECONDS=0
: >"$KUBECTL_ARGUMENTS_FILE"
LAST_ERROR=""
kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_ARGUMENTS_FILE"
  [[ "$*" == "wait --for=condition=available deployment/opencrane-test-pooler -n opencrane-test --timeout=2s" ]]
}

wait_for_postgres_resource condition=available "deployment/opencrane-test-pooler" "pooler was not available"
[[ "$(wc -l <"$KUBECTL_ARGUMENTS_FILE" | tr -d ' ')" -eq 1 ]]
[[ -z "$LAST_ERROR" ]]

echo "postgres release contract: PASS"
