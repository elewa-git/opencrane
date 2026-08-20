#!/usr/bin/env bash

# Decides whether one deploy may skip the database stage and change only the app workloads.
#
# A normal deploy always reconciles the PostgreSQL release and runs the privileges Job, even when the
# run changes nothing but a container image. That is the slowest part of a deploy and the part that
# can fail closed, so a run that only moves workload images can skip it — but only when the data
# plane is provably already where this release expects it. This module makes that decision from
# evidence the engine has already read; it never reads or changes the cluster itself.
#
# k8s-deploy.sh gathers the evidence and runs Helm.

# Refuses the workloads-only path unless every fact says the data plane is already converged.
#
# The checks are ordered cheapest-explanation-first so an operator reads the real reason, not a
# consequence of it. Each refusal names the full deploy as the way forward, because that is always
# correct — this path is an optimisation, never the only way to reach a state.
#
# `convergence_state` is the classifier's verdict for the live database, or the empty string when the
# engine could not read one. An unreadable verdict refuses: silence is not evidence.
#
# Called by: k8s-deploy.sh, before run_database_release_transition.
assert_workloads_only_preconditions()
{
  local cluster_exists="$1"
  local transition_kind="$2"
  local live_release_status="$3"
  local live_chart_version="$4"
  local intended_chart_version="$5"
  local convergence_state="$6"

  if [[ "$cluster_exists" != "1" ]]; then
    err "--workloads-only cannot install a silo that has no PostgreSQL cluster yet. Deploy this silo once in full first."
    return 1
  fi
  if [[ "$transition_kind" != "current" ]]; then
    err "--workloads-only refuses a '$transition_kind' database transition, which has schema work to do. Deploy in full."
    return 1
  fi
  if [[ "$live_release_status" != "deployed" ]]; then
    err "--workloads-only refuses to skip over a PostgreSQL release in state '$live_release_status'. Deploy in full so the data plane is repaired first."
    return 1
  fi
  if [[ -z "$intended_chart_version" || "$live_chart_version" != "$intended_chart_version" ]]; then
    err "--workloads-only requires the live PostgreSQL chart ('$live_chart_version') to already be the version this run installs ('$intended_chart_version'). Deploy in full to apply the chart change."
    return 1
  fi
  if [[ ! "$convergence_state" =~ ^(current|completed)\| ]]; then
    err "--workloads-only requires the live database to already match this release; the classifier reported '${convergence_state:-no readable evidence}'. Deploy in full."
    return 1
  fi
}
