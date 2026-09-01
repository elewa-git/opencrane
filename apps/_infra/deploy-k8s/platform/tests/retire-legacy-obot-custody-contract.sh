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

assert_prefix_count()
{
  local expected="$1"
  local prefix="$2"
  awk -v expected="$expected" -v prefix="$prefix" '
    index($0, prefix) == 1 { count += 1 }
    END {
      if (count + 0 != expected) {
        printf "Expected %s call(s) prefixed by %s, found %s.\n", expected, prefix, count + 0 > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

assert_prefix_present()
{
  local prefix="$1"
  awk -v prefix="$prefix" '
    index($0, prefix) == 1 { found = 1 }
    END {
      if (!found) {
        printf "Expected a call prefixed by %s.\n", prefix > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

assert_identity_preconditioned_delete_count()
{
  local expected="$1"
  awk -v expected="$expected" '
    index($0, "delete-options ") == 1 &&
    index($0, "\"preconditions\":{\"uid\":") > 0 { count += 1 }
    END {
      if (count + 0 != expected) {
        printf "Expected %s identity-preconditioned delete(s), found %s.\n", expected, count + 0 > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

assert_delete_calls_exclude()
{
  local needle="$1"
  awk -v needle="$needle" '
    index($0, "delete --raw ") == 1 && index($0, needle) > 0 { found = 1 }
    END {
      if (found) {
        printf "Expected raw delete calls to exclude %s.\n", needle > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

assert_file_contains()
{
  local file="$1"
  local needle="$2"
  awk -v needle="$needle" '
    index($0, needle) > 0 { found = 1 }
    END {
      if (!found) {
        printf "Expected file to contain: %s\n", needle > "/dev/stderr"
        exit 1
      }
    }
  ' "$file"
}

assert_custody_call_order()
{
  awk '
    index($0, "patch database.postgresql.cnpg.io/opencrane-testv4-postgres-obot ") == 1 && !database_patch { database_patch = NR }
    index($0, "exec opencrane-testv4-postgres-1 ") == 1 && !proof { proof = NR }
    index($0, "patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres ") == 1 { role_patch = NR }
    index($0, "delete --raw ") == 1 && !first_delete { first_delete = NR }
    END {
      if (!database_patch || !proof || !role_patch || !first_delete ||
          database_patch >= proof || proof >= role_patch || role_patch >= first_delete) {
        print "Expected Database retirement, SQL proof, role retirement, and raw deletes in order." > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

assert_deploy_order()
{
  awk '
    index($0, "retire_legacy_obot_mcp_server_resources ") > 0 { server_retire = NR }
    index($0, "retire_legacy_obot_database_custody ") > 0 { custody_retire = NR }
    index($0, "_post_deploy_verify ") == 1 { advisory = NR }
    END {
      if (!server_retire || !custody_retire || !advisory ||
          server_retire >= custody_retire || custody_retire >= advisory) {
        print "Expected server retirement, custody retirement, and advisory verification in order." > "/dev/stderr"
        exit 1
      }
    }
  ' "$DEPLOY"
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
    IFS= read -r delete_options
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
assert_prefix_count 3 'delete --raw '
assert_identity_preconditioned_delete_count 3
assert_custody_call_order
assert_prefix_count 2 'patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres '
assert_delete_calls_exclude 'opencrane-testv4-obot-postgres-bootstrap'

: >"$CALLS"
retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30
assert_prefix_present 'exec '
assert_prefix_count 0 'patch '
assert_prefix_count 0 'delete --raw '

reset_fixture
DATABASE_CHART="postgres-foreign"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement accepted a foreign Database authority" >&2
  exit 1
fi
assert_prefix_count 0 'patch '
assert_prefix_count 0 'exec '
assert_prefix_count 0 'delete --raw '

reset_fixture
DATABASE_WAIT_UID="replacement-uid"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement ignored a changed Database UID" >&2
  exit 1
fi
assert_prefix_present 'patch '
assert_prefix_count 0 'exec '
assert_prefix_count 0 'delete --raw '

reset_fixture
DATABASE_ENSURE="absent"
LOGICAL_DATABASE_COUNT="1"
LOGICAL_ROLE_COUNT="0"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement deleted objects before the logical database was absent" >&2
  exit 1
fi
assert_prefix_present 'exec '
assert_prefix_count 0 'delete --raw '

reset_fixture
DATABASE_PRESENT=0
ADAPTER_SECRET_PRESENT=0
APP_SECRET_PRESENT=0
LOGICAL_DATABASE_COUNT="1"
if retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30; then
  echo "Obot custody retirement ignored an unmanaged logical database residue" >&2
  exit 1
fi
assert_prefix_count 0 'patch '
assert_prefix_count 0 'delete --raw '

reset_fixture
DATABASE_PRESENT=0
ADAPTER_SECRET_PRESENT=0
APP_SECRET_PRESENT=0
LOGICAL_DATABASE_COUNT="0"
LOGICAL_ROLE_COUNT="1"
retire_legacy_obot_database_custody opencrane-testv4 opencrane-testv4 30
assert_prefix_count 2 'patch cluster.postgresql.cnpg.io/opencrane-testv4-postgres '
assert_prefix_count 0 'delete --raw '

assert_file_contains "$DEPLOY" 'retire_legacy_obot_database_custody "$NAMESPACE" "$RELEASE" "$TIMEOUT"'
assert_deploy_order

echo "legacy Obot custody retirement contract: PASS"
