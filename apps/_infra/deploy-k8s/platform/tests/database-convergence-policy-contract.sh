#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-convergence-policy.sh"

bash -n "$POLICY"
source "$POLICY"

assert_outcome()
{
  local event="$1"
  local state="$2"
  local expected="$3"
  local actual
  actual="$(resolve_database_convergence_outcome "$event" "$state")"
  [[ "$actual" == "$expected" ]]
}

assert_outcome live_transition current reconcile_without_fence
assert_outcome live_transition completed reconcile_without_fence
assert_outcome live_transition source migrate_source
assert_outcome live_transition incompatible reject_before_fence
assert_outcome recovered_transition current reconcile_while_fenced
assert_outcome recovered_transition completed reconcile_while_fenced
assert_outcome recovered_transition source migrate_recovered_source
assert_outcome recovered_transition incompatible reject_keep_fence
assert_outcome failed_transition current keep_fence
assert_outcome failed_transition completed keep_fence
assert_outcome failed_transition source rollback_source
assert_outcome failed_transition incompatible keep_fence

if resolve_database_convergence_outcome unknown_event source >/dev/null 2>&1; then
  echo "database convergence policy accepted an unknown event" >&2
  exit 1
fi
if resolve_database_convergence_outcome live_transition unknown_state >/dev/null 2>&1; then
  echo "database convergence policy accepted an unknown state" >&2
  exit 1
fi

echo "database convergence policy contract: PASS"
