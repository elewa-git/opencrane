#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/workloads-only-policy.sh"

source "$POLICY"

err()
{
  printf '%s\n' "$*" >&2
}

# Evidence from a silo whose data plane already matches the release being deployed.
_converged()
{
  assert_workloads_only_preconditions 1 current deployed 0.9.1 0.9.1 "completed|$(printf 'a%.0s' {1..64})"
}

_converged

# A fresh silo has no data plane to compare against, so the stage cannot be skipped.
if assert_workloads_only_preconditions 0 fresh "" "" 0.9.1 "" 2>/dev/null; then
  echo "workloads-only accepted a silo with no PostgreSQL cluster" >&2
  exit 1
fi

# Schema work must never be skipped, however healthy the release looks.
if assert_workloads_only_preconditions 1 migration deployed 0.9.1 0.9.1 "source|$(printf 'a%.0s' {1..64})" 2>/dev/null; then
  echo "workloads-only accepted a migration transition" >&2
  exit 1
fi

# Skipping over a failed PostgreSQL release would leave it failed and report success.
if assert_workloads_only_preconditions 1 current failed 0.9.1 0.9.1 "current|$(printf 'a%.0s' {1..64})" 2>/dev/null; then
  echo "workloads-only accepted a failed PostgreSQL release" >&2
  exit 1
fi

# A chart version bump carries template changes — privileges among them — that must be applied.
if assert_workloads_only_preconditions 1 current deployed 0.9.1 0.9.2 "current|$(printf 'a%.0s' {1..64})" 2>/dev/null; then
  echo "workloads-only accepted an unapplied PostgreSQL chart version" >&2
  exit 1
fi

# An unreadable classifier verdict is not evidence of convergence.
if assert_workloads_only_preconditions 1 current deployed 0.9.1 0.9.1 "" 2>/dev/null; then
  echo "workloads-only accepted a missing convergence verdict" >&2
  exit 1
fi

# A database the classifier calls incompatible is the case this path must never step over.
if assert_workloads_only_preconditions 1 current deployed 0.9.1 0.9.1 "incompatible|$(printf 'a%.0s' {1..64})" 2>/dev/null; then
  echo "workloads-only accepted an incompatible database" >&2
  exit 1
fi

# A 'current' verdict is accepted alongside 'completed': both mean the schema is already in place.
assert_workloads_only_preconditions 1 current deployed 0.9.1 0.9.1 "current|$(printf 'a%.0s' {1..64})"

echo "workloads-only policy contract: PASS"
