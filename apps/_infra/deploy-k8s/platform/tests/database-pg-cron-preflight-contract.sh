#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
PREFLIGHT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-pg-cron-preflight.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-database-pg-cron-preflight.XXXXXX")"
SQL_CAPTURE="$TEST_DIR/psql.sql"
KUBECTL_CALLS="$TEST_DIR/kubectl.calls"
DIAGNOSTIC="$TEST_DIR/diagnostic.log"
trap 'rm -rf -- "$TEST_DIR"' EXIT

bash -n "$PREFLIGHT"
source "$PREFLIGHT"

NAMESPACE=opencrane-test
POSTGRES_RELEASE=opencrane-test-postgres
TIMEOUT=23

ready_primary_json()
{
  printf '%s\n' '{"items":[{"metadata":{"name":"opencrane-test-postgres-1"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}'
}

kubectl()
{
  printf '%s\n' "$*" >>"$KUBECTL_CALLS"
  if [[ "$*" == *" get pods "* ]]; then
    if [[ "${MOCK_GET_FAILURE:-false}" == "true" ]]; then
      return 42
    fi
    case "${MOCK_PRIMARY_INVENTORY:-ready}" in
      ready) ready_primary_json ;;
      missing) printf '%s\n' '{"items":[]}' ;;
      multiple)
        printf '%s\n' '{"items":[{"metadata":{"name":"primary-1"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}},{"metadata":{"name":"primary-2"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}'
        ;;
      unready)
        printf '%s\n' '{"items":[{"metadata":{"name":"primary-1"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"False"}]}}]}'
        ;;
      *) return 43 ;;
    esac
    return
  fi
  if [[ "$*" == *" exec "* ]]; then
    tee -a "$SQL_CAPTURE" >/dev/null
    if [[ "${MOCK_PSQL_FAILURE:-false}" == "true" ]]; then
      return 44
    fi
    if [[ "$*" == *"SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')"* ]]; then
      printf '%s\n' "${MOCK_EXTENSION_OUTPUT:-ready}"
      return
    fi
    printf '%s\n' "${MOCK_PREFLIGHT_OUTPUT:-ready}"
    return
  fi
  printf 'unexpected kubectl call: %s\n' "$*" >&2
  return 45
}

[[ "$(verify_database_pg_cron_preflight)" == "ready" ]]

grep -Fq 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' "$SQL_CAPTURE"
grep -Fq "SET LOCAL statement_timeout = :'statement_timeout_ms';" "$SQL_CAPTURE"
grep -Fq "SET LOCAL idle_in_transaction_session_timeout = :'statement_timeout_ms';" "$SQL_CAPTURE"
grep -Fq 'FROM pg_available_extensions' "$SQL_CAPTURE"
grep -Fq "WHERE name = 'pg_cron'" "$SQL_CAPTURE"
grep -Fq "current_setting('shared_preload_libraries', true)" "$SQL_CAPTURE"
grep -Fq "current_setting('cron.database_name', true) = current_database()" "$SQL_CAPTURE"
grep -Fq "current_database() = 'opencrane'" "$SQL_CAPTURE"
grep -Fq "FROM pg_extension WHERE extname = 'pg_cron'" "$KUBECTL_CALLS"
[[ "$(grep -c '^BEGIN TRANSACTION ' "$SQL_CAPTURE")" == "1" ]]
[[ "$(grep -c '^COMMIT;$' "$SQL_CAPTURE")" == "1" ]]
if grep -Eiq '^[[:space:]]*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|MERGE|CALL|DO|COPY)[[:space:]]' "$SQL_CAPTURE"; then
  printf 'pg_cron preflight contains a mutating SQL statement\n' >&2
  exit 1
fi
if grep -Eiq 'FOR[[:space:]]+(UPDATE|NO[[:space:]]+KEY[[:space:]]+UPDATE|SHARE|KEY[[:space:]]+SHARE)' "$SQL_CAPTURE"; then
  printf 'pg_cron preflight acquires a row lock\n' >&2
  exit 1
fi

grep -Fq -- '--request-timeout=23s get pods --namespace opencrane-test --selector cnpg.io/cluster=opencrane-test-postgres,role=primary -o json' "$KUBECTL_CALLS"
grep -Fq -- '--request-timeout=23s exec --namespace opencrane-test --container postgres -i opencrane-test-postgres-1 -- psql' "$KUBECTL_CALLS"
grep -Fq -- '--dbname opencrane' "$KUBECTL_CALLS"
grep -Fq -- '--set statement_timeout_ms=23000' "$KUBECTL_CALLS"
if grep -Eiq '(password|secret|credential)' "$KUBECTL_CALLS"; then
  printf 'pg_cron preflight exposed credential material through a kubectl argument\n' >&2
  exit 1
fi

assert_failure()
{
  local description="$1"
  shift
  : >"$DIAGNOSTIC"
  if env "$@" bash -c '
    source "$1"
    source "$2"
    verify_database_pg_cron_preflight
  ' bash "$TEST_DIR/environment.sh" "$PREFLIGHT" >"$TEST_DIR/unexpected.out" 2>"$DIAGNOSTIC"; then
    printf 'pg_cron preflight unexpectedly accepted %s\n' "$description" >&2
    exit 1
  fi
  [[ -s "$DIAGNOSTIC" ]]
  [[ ! -s "$TEST_DIR/unexpected.out" ]]
}

declare -f ready_primary_json kubectl >"$TEST_DIR/environment.sh"
export NAMESPACE POSTGRES_RELEASE TIMEOUT TEST_DIR SQL_CAPTURE KUBECTL_CALLS

assert_failure 'a missing primary' MOCK_PRIMARY_INVENTORY=missing
assert_failure 'multiple primaries' MOCK_PRIMARY_INVENTORY=multiple
assert_failure 'an unready primary' MOCK_PRIMARY_INVENTORY=unready
assert_failure 'a kubectl inventory failure' MOCK_GET_FAILURE=true
assert_failure 'a kubectl exec or psql failure' MOCK_PSQL_FAILURE=true
assert_failure 'unavailable extension evidence' MOCK_PREFLIGHT_OUTPUT=unavailable
assert_failure 'malformed extension evidence' MOCK_PREFLIGHT_OUTPUT=ambiguous
assert_failure 'an uninstalled pg_cron extension' MOCK_EXTENSION_OUTPUT=unavailable
assert_failure 'an invalid timeout' TIMEOUT=0

echo "database pg_cron preflight contract: PASS"
