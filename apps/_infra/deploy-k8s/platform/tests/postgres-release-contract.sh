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

helm()
{
  [[ "$1" == "status" ]] && return 1
  return 0
}

kubectl()
{
  KUBECTL_CALLS+=("$*")
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

echo "postgres release contract: PASS"
