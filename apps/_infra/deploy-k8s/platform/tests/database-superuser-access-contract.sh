#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
PROOF="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-superuser-access.sh"

bash -n "$PROOF"
source "$PROOF"

NAMESPACE=opencrane-test
POSTGRES_RELEASE=opencrane-test-postgres
TIMEOUT=23

kubectl()
{
  if [[ "$*" == *" get cluster/"* ]]; then
    [[ "${MOCK_CLUSTER_FAILURE:-false}" != "true" ]] || return 41
    if [[ "${MOCK_SUPERUSER_ENABLED:-false}" == "true" ]]; then
      printf '%s\n' '{"spec":{"enableSuperuserAccess":true}}'
    else
      printf '%s\n' '{"spec":{"enableSuperuserAccess":false}}'
    fi
    return
  fi
  if [[ "$*" == *" get secret/"* ]]; then
    [[ "${MOCK_SECRET_FAILURE:-false}" != "true" ]] || return 42
    [[ "${MOCK_SUPERUSER_SECRET:-false}" != "true" ]] && return
    printf '%s\n' "secret/${POSTGRES_RELEASE}-superuser"
    return
  fi
  printf 'unexpected kubectl call: %s\n' "$*" >&2
  return 43
}

verify_database_superuser_access_disabled

assert_failure()
{
  local description="$1"
  shift
  if (
    for setting in "$@"; do export "$setting"; done
    verify_database_superuser_access_disabled
  ); then
    printf 'superuser-access proof unexpectedly accepted %s\n' "$description" >&2
    exit 1
  fi
}

assert_failure 'enabled CNPG superuser access' MOCK_SUPERUSER_ENABLED=true
assert_failure 'a remaining CNPG superuser Secret' MOCK_SUPERUSER_SECRET=true
assert_failure 'an unreadable Cluster' MOCK_CLUSTER_FAILURE=true
assert_failure 'an unreadable superuser Secret inventory' MOCK_SECRET_FAILURE=true

echo "database superuser-access contract: PASS"
