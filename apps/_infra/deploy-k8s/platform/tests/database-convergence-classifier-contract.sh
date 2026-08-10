#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CLASSIFIER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-convergence-classifier.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-database-classifier.XXXXXX")"
SQL_CAPTURE="$TEST_DIR/psql.sql"
KUBECTL_CALLS="$TEST_DIR/kubectl.calls"
DIAGNOSTIC="$TEST_DIR/diagnostic.log"
trap 'rm -rf -- "$TEST_DIR"' EXIT

bash -n "$CLASSIFIER"
source "$CLASSIFIER"

NAMESPACE=opencrane-test
POSTGRES_RELEASE=opencrane-test-postgres
TIMEOUT=23
POSTGRES_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
DATABASE_PREVIOUS_MIGRATION_ID=0.7.0-to-0.8.0
DATABASE_PREVIOUS_SCHEMA_VERSION=0.7.0
DATABASE_TARGET_SCHEMA_VERSION=0.8.0
DATABASE_TARGET_BASELINE_SHA256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
DATABASE_PREVIOUS_MIGRATION_SQL_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd

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
    tee "$SQL_CAPTURE" >/dev/null
    if [[ "${MOCK_PSQL_FAILURE:-false}" == "true" ]]; then
      return 44
    fi
    printf '%s\n' "${MOCK_CONVERGENCE_OUTPUT:-current}"
    return
  fi
  printf 'unexpected kubectl call: %s\n' "$*" >&2
  return 45
}

assert_state()
{
  local expected="$1"
  local actual
  MOCK_PRIMARY_INVENTORY=ready
  MOCK_CONVERGENCE_OUTPUT="$expected"
  actual="$(classify_live_database_convergence)"
  [[ "$actual" == "$expected" ]]
}

# The classifier's result alphabet is exhaustive. The incompatible case models a readable origin
# or tuple mismatch; the second incompatible case models an exact row plus an extra history row.
assert_state current
assert_state completed
assert_state source
assert_state incompatible
MOCK_PRIMARY_INVENTORY=ready
MOCK_CONVERGENCE_OUTPUT=incompatible
[[ "$(classify_live_database_convergence)" == "incompatible" ]]

# The one captured psql program owns the actual evidence mapping. Exact completion requires both
# one total history row and one exact tuple; an extra row therefore cannot classify as completed.
grep -Fq 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' "$SQL_CAPTURE"
grep -Fq "SET LOCAL statement_timeout = :'statement_timeout_ms';" "$SQL_CAPTURE"
grep -Fq "SET LOCAL idle_in_transaction_session_timeout = :'statement_timeout_ms';" "$SQL_CAPTURE"
grep -Fq '\if :history_exists' "$SQL_CAPTURE"
grep -Fq "AND :'history_total'::bigint = 1" "$SQL_CAPTURE"
grep -Fq "AND :'exact_history_total'::bigint = 1" "$SQL_CAPTURE"
grep -Fq "AND :'recorded_origin' = :'current_protected_baseline_sha256'" "$SQL_CAPTURE"
grep -Fq "AND :'recorded_origin' = :'previous_protected_baseline_sha256'" "$SQL_CAPTURE"
grep -Fq "ELSE 'incompatible'" "$SQL_CAPTURE"
[[ "$(grep -c '^BEGIN TRANSACTION ' "$SQL_CAPTURE")" == "1" ]]
[[ "$(grep -c '^COMMIT;$' "$SQL_CAPTURE")" == "1" ]]
if grep -Eiq '^[[:space:]]*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|MERGE|CALL|DO|COPY)[[:space:]]' "$SQL_CAPTURE"; then
  printf 'classifier psql transaction contains a mutating statement\n' >&2
  exit 1
fi
if grep -Eiq 'FOR[[:space:]]+(UPDATE|NO[[:space:]]+KEY[[:space:]]+UPDATE|SHARE|KEY[[:space:]]+SHARE)' "$SQL_CAPTURE"; then
  printf 'classifier psql transaction acquires a row lock\n' >&2
  exit 1
fi

grep -Fq -- '--request-timeout=23s get pods --namespace opencrane-test --selector cnpg.io/cluster=opencrane-test-postgres,role=primary -o json' "$KUBECTL_CALLS"
grep -Fq -- '--request-timeout=23s exec --namespace opencrane-test --container postgres -i opencrane-test-postgres-1 -- psql' "$KUBECTL_CALLS"
grep -Fq -- '--dbname opencrane' "$KUBECTL_CALLS"
grep -Fq -- '--set statement_timeout_ms=23000' "$KUBECTL_CALLS"
if grep -Eiq '(password|secret|credential)' "$KUBECTL_CALLS"; then
  printf 'classifier exposed credential material through a kubectl argument\n' >&2
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
    classify_live_database_convergence
  ' bash "$TEST_DIR/environment.sh" "$CLASSIFIER" >"$TEST_DIR/unexpected.out" 2>"$DIAGNOSTIC"; then
    printf 'classifier unexpectedly accepted %s\n' "$description" >&2
    exit 1
  fi
  [[ -s "$DIAGNOSTIC" ]]
  [[ ! -s "$TEST_DIR/unexpected.out" ]]
}

# Export the mock and fixed manifest globals into clean shells so every failure assertion proves a
# nonzero public-function result with a diagnostic and no accidental state token on stdout.
declare -f ready_primary_json kubectl >"$TEST_DIR/environment.sh"
export NAMESPACE POSTGRES_RELEASE TIMEOUT POSTGRES_BASELINE_SHA256
export DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256 DATABASE_PREVIOUS_MIGRATION_ID
export DATABASE_PREVIOUS_SCHEMA_VERSION DATABASE_TARGET_SCHEMA_VERSION
export DATABASE_TARGET_BASELINE_SHA256 DATABASE_PREVIOUS_MIGRATION_SQL_SHA256
export TEST_DIR SQL_CAPTURE KUBECTL_CALLS

assert_failure 'a missing primary' MOCK_PRIMARY_INVENTORY=missing
assert_failure 'multiple primaries' MOCK_PRIMARY_INVENTORY=multiple
assert_failure 'an unready primary' MOCK_PRIMARY_INVENTORY=unready
assert_failure 'a kubectl inventory failure' MOCK_GET_FAILURE=true
assert_failure 'a kubectl exec or psql failure' MOCK_PSQL_FAILURE=true
assert_failure 'malformed psql output' MOCK_CONVERGENCE_OUTPUT=ambiguous
assert_failure 'ambiguous equal current and previous origins' \
  DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256="$POSTGRES_BASELINE_SHA256"

echo "database convergence classifier contract: PASS"
