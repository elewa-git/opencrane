#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
RETIREMENT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/retire-legacy-obot-mcp-server.sh"
DEPLOY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
CALLS="$TEST_DIR/calls"

err()
{
  printf '%s\n' "$*" >&2
}

log()
{
  :
}

reset_fixture()
{
  : >"$CALLS"
  rm -f "$TEST_DIR"/deleted-*
  DATABASE_PRESENT=1
  DATABASE_UID="database-uid"
  DATABASE_WAIT_UID="$DATABASE_UID"
  DATABASE_RESOURCE_VERSION="database-rv-1"
  DATABASE_CHART="postgres-0.9.3"
  DATABASE_ENSURE="present"
  DATABASE_GENERATION="1"
  DATABASE_OBSERVED_GENERATION="1"
  DATABASE_APPLIED="true"
  LOGICAL_DATABASE_COUNT="1"
  LOGICAL_ROLE_COUNT="1"
  CLUSTER_UID="cluster-uid"
  CLUSTER_RESOURCE_VERSION="cluster-rv-1"
  CLUSTER_ROLE_TOMBSTONE=0
  ADAPTER_SECRET_PRESENT=1
  APP_SECRET_PRESENT=1
}

resource_from_uri()
{
  case "$1" in
    */databases/*) printf 'database.postgresql.cnpg.io/%s' "${1##*/}" ;;
    */secrets/*) printf 'secret/%s' "${1##*/}" ;;
    *) return 1 ;;
  esac
}

deleted_marker()
{
  printf '%s/deleted-%s' "$TEST_DIR" "${1//\//-}"
}

kubectl()
{
  printf '%s\n' "$*" >>"$CALLS"
  local command="$1"
  local resource="${2:-}"
  local args="$*"
  if [[ "$command" == "patch" ]]; then
    if [[ "$resource" == "database.postgresql.cnpg.io/opencrane-testv4-postgres-obot" ]]; then
      [[ "$args" == *'"resourceVersion":"database-rv-1"'* ]]
      [[ "$args" == *'"ensure":"absent"'* ]]
      DATABASE_ENSURE="absent"
      DATABASE_GENERATION="2"
      DATABASE_OBSERVED_GENERATION="2"
      DATABASE_RESOURCE_VERSION="database-rv-2"
      LOGICAL_DATABASE_COUNT="0"
    else
      [[ "$resource" == "cluster.postgresql.cnpg.io/opencrane-testv4-postgres" ]]
      if (( CLUSTER_ROLE_TOMBSTONE == 0 )); then
        [[ "$args" == *'"name":"obot","ensure":"absent"'* ]]
        CLUSTER_ROLE_TOMBSTONE=1
        CLUSTER_RESOURCE_VERSION="cluster-rv-2"
        LOGICAL_ROLE_COUNT="0"
      else
        [[ "$args" == *'"op":"remove","path":"/spec/managed/roles/1"'* ]]
        CLUSTER_ROLE_TOMBSTONE=0
        CLUSTER_RESOURCE_VERSION="cluster-rv-3"
      fi
    fi
    return 0
  fi
  if [[ "$command" == "exec" ]]; then
    [[ "$resource" == "opencrane-testv4-postgres-1" ]]
    printf '%s %s\n' "$LOGICAL_DATABASE_COUNT" "$LOGICAL_ROLE_COUNT"
    return 0
  fi
  if [[ "$command" == "delete" && "$resource" == "--raw" ]]; then
    local deleted_resource
    local delete_options
    deleted_resource="$(resource_from_uri "$3")"
    delete_options="$(<&0)"
    printf 'delete-options %s %s\n' "$deleted_resource" "$delete_options" >>"$CALLS"
    touch "$(deleted_marker "$deleted_resource")"
    return 0
  fi
  [[ "$command" == "get" ]]
  if [[ "$resource" == "pod" ]]; then
    printf 'opencrane-testv4-postgres-1'
    return 0
  fi
  if [[ "$resource" == database.postgresql.cnpg.io/* ]]; then
    if (( DATABASE_PRESENT == 0 )) || [[ -e "$(deleted_marker "$resource")" ]]; then
      return 0
    fi
    if [[ "$args" == *"CHART:.metadata.labels.helm"* ]]; then
      printf '%s %s %s Helm %s opencrane-testv4-postgres opencrane-testv4 opencrane-testv4-postgres obot obot %s retain\n' \
        "${resource#*/}" "$DATABASE_UID" "$DATABASE_RESOURCE_VERSION" "$DATABASE_CHART" "$DATABASE_ENSURE"
    elif [[ "$args" == *"GEN:.metadata.generation"* ]]; then
      printf '%s %s %s %s %s\n' "$DATABASE_WAIT_UID" "$DATABASE_GENERATION" "$DATABASE_OBSERVED_GENERATION" "$DATABASE_APPLIED" "$DATABASE_ENSURE"
    elif [[ "$args" == *"custom-columns=UID:.metadata.uid,RV:.metadata.resourceVersion"* ]]; then
      printf '%s %s\n' "$DATABASE_UID" "$DATABASE_RESOURCE_VERSION"
    elif [[ "$args" == *"jsonpath={.metadata.uid}"* ]]; then
      printf '%s' "$DATABASE_UID"
    fi
    return 0
  fi
  if [[ "$resource" == "cluster.postgresql.cnpg.io/opencrane-testv4-postgres" ]]; then
    if [[ "$args" == *"MANAGED:.metadata.labels.app"* ]]; then
      printf 'opencrane-testv4-postgres %s %s Helm opencrane-testv4-postgres opencrane-testv4\n' "$CLUSTER_UID" "$CLUSTER_RESOURCE_VERSION"
    elif [[ "$args" == *"-o json"* ]]; then
      if (( CLUSTER_ROLE_TOMBSTONE == 1 )); then
        printf '{"metadata":{"uid":"%s","resourceVersion":"%s"},"spec":{"managed":{"roles":[{"name":"litellm","ensure":"present"},{"name":"obot","ensure":"absent"}]}}}' "$CLUSTER_UID" "$CLUSTER_RESOURCE_VERSION"
      else
        printf '{"metadata":{"uid":"%s","resourceVersion":"%s"},"spec":{"managed":{"roles":[{"name":"litellm","ensure":"present"}]}}}' "$CLUSTER_UID" "$CLUSTER_RESOURCE_VERSION"
      fi
    fi
    return 0
  fi
  if [[ "$resource" == "secret/opencrane-testv4-obot" ]]; then
    if (( ADAPTER_SECRET_PRESENT == 1 )) && [[ ! -e "$(deleted_marker "$resource")" ]]; then
      if [[ "$args" == *"TYPE:.type"* ]]; then
        printf 'opencrane-testv4-obot adapter-uid adapter-rv Opaque <none> <none> <none>\n'
      elif [[ "$args" == *"jsonpath={.metadata.uid}"* ]]; then
        printf 'adapter-uid'
      fi
    fi
    return 0
  fi
  if [[ "$resource" == "secret/opencrane-testv4-postgres-obot-app" ]]; then
    if (( APP_SECRET_PRESENT == 1 )) && [[ ! -e "$(deleted_marker "$resource")" ]]; then
      if [[ "$args" == *"TYPE:.type"* ]]; then
        printf 'opencrane-testv4-postgres-obot-app app-uid app-rv Opaque opencrane-postgres opencrane-testv4-obot-postgres-bootstrap <none>\n'
      elif [[ "$args" == *"jsonpath={.metadata.uid}"* ]]; then
        printf 'app-uid'
      fi
    fi
    return 0
  fi
  return 1
}

source "$RETIREMENT"

reset_fixture
retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30
[[ -e "$(deleted_marker database.postgresql.cnpg.io/opencrane-testv4-postgres-obot)" ]]
[[ -e "$(deleted_marker secret/opencrane-testv4-obot)" ]]
[[ -e "$(deleted_marker secret/opencrane-testv4-postgres-obot-app)" ]]
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "3" ]]
[[ "$(grep -c '^delete-options .*\"preconditions\":{\"uid\":' "$CALLS")" == "3" ]]
patch_line="$(grep -n '^patch database.postgresql.cnpg.io/opencrane-testv4-postgres-obot ' "$CALLS" | cut -d: -f1)"
proof_line="$(grep -n '^exec opencrane-testv4-postgres-1 ' "$CALLS" | head -1 | cut -d: -f1)"
last_role_patch_line="$(grep -n '^patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres ' "$CALLS" | tail -1 | cut -d: -f1)"
first_delete_line="$(grep -n '^delete --raw ' "$CALLS" | head -1 | cut -d: -f1)"
[[ "$patch_line" -lt "$proof_line" && "$proof_line" -lt "$last_role_patch_line" && "$last_role_patch_line" -lt "$first_delete_line" ]]
[[ "$(grep -c '^patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres ' "$CALLS")" == "2" ]]
! grep -Fq 'opencrane-testv4-obot-postgres-bootstrap' <(grep '^delete --raw ' "$CALLS")

: >"$CALLS"
retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30
grep -q '^exec ' "$CALLS"
! grep -q '^patch\|^delete --raw ' "$CALLS"

reset_fixture
DATABASE_CHART="postgres-foreign"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement accepted a foreign Database authority" >&2
  exit 1
fi
! grep -q '^patch\|^exec\|^delete --raw ' "$CALLS"

reset_fixture
DATABASE_WAIT_UID="replacement-uid"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement ignored a changed Database UID" >&2
  exit 1
fi
grep -q '^patch ' "$CALLS"
! grep -q '^exec\|^delete --raw ' "$CALLS"

reset_fixture
DATABASE_ENSURE="absent"
LOGICAL_DATABASE_COUNT="1"
LOGICAL_ROLE_COUNT="0"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement deleted objects before the logical database was absent" >&2
  exit 1
fi
grep -q '^exec ' "$CALLS"
! grep -q '^delete --raw ' "$CALLS"

reset_fixture
DATABASE_PRESENT=0
ADAPTER_SECRET_PRESENT=0
APP_SECRET_PRESENT=0
LOGICAL_DATABASE_COUNT="1"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement ignored an unmanaged logical database residue" >&2
  exit 1
fi
! grep -q '^patch\|^delete --raw ' "$CALLS"

reset_fixture
DATABASE_PRESENT=0
ADAPTER_SECRET_PRESENT=0
APP_SECRET_PRESENT=0
LOGICAL_DATABASE_COUNT="0"
LOGICAL_ROLE_COUNT="1"
retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30
[[ "$(grep -c '^patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres ' "$CALLS")" == "2" ]]
! grep -q '^delete --raw ' "$CALLS"

grep -Fq 'retire_legacy_obot_database_custody "$NAMESPACE" "$RELEASE" "$TIMEOUT"' "$DEPLOY"
server_retire_line="$(grep -n 'retire_legacy_obot_mcp_server_resources ' "$DEPLOY" | tail -1 | cut -d: -f1)"
custody_retire_line="$(grep -n 'retire_legacy_obot_database_custody ' "$DEPLOY" | tail -1 | cut -d: -f1)"
advisory_line="$(grep -n '^_post_deploy_verify ' "$DEPLOY" | tail -1 | cut -d: -f1)"
[[ "$server_retire_line" -lt "$custody_retire_line" && "$custody_retire_line" -lt "$advisory_line" ]]

echo "legacy Obot custody retirement contract: PASS"
