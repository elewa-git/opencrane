#!/usr/bin/env bash
# Owns application finalization after the database release transition. It restores the exact fenced
# Helm revision when un-fencing, Secret-triggered restarts, rollout waits, certificate readiness, or
# verification fail.

capture_fenced_main_release_revision()
{
  local fenced_release_status
  local status_result
  if fenced_release_status="$(helm status "$RELEASE" -n "$NAMESPACE" -o json)"; then
    status_result=0
  else
    status_result=$?
  fi
  if (( status_result != 0 )); then
    err "Unable to read the fenced OpenCrane Helm release before final application transition."
    return "$status_result"
  fi
  if ! DATABASE_FENCED_RELEASE_REVISION="$(jq -er '.version | select(type == "number" and . > 0) | floor | tostring' \
    <<<"$fenced_release_status")"; then
    err "Unable to capture the exact fenced OpenCrane Helm revision."
    return 1
  fi
}

restore_fenced_release_after_finalization_failure()
{
  local original_status="$1"
  local rollback_status
  err "Final OpenCrane application transition failed; restoring the exact fenced release revision."
  if helm rollback "$RELEASE" "$DATABASE_FENCED_RELEASE_REVISION" \
    --namespace "$NAMESPACE" \
    --wait \
    --timeout "${TIMEOUT}s" \
    --force-conflicts; then
    rollback_status=0
  else
    rollback_status=$?
  fi
  if (( rollback_status != 0 )); then
    err "Rollback to fenced Helm revision '$DATABASE_FENCED_RELEASE_REVISION' failed; manual fence verification is required."
  fi
  return "$original_status"
}

run_fenced_finalization_stage()
{
  local stage_status
  if "$@"; then
    stage_status=0
  else
    stage_status=$?
  fi
  if (( stage_status == 0 )); then
    return 0
  fi
  restore_fenced_release_after_finalization_failure "$stage_status"
}

run_opencrane_finalization_stage()
{
  if [[ -n "$DATABASE_FENCED_RELEASE_REVISION" ]]; then
    run_fenced_finalization_stage "$@"
    return
  fi
  "$@"
}

restart_database_consumers_for_finalization()
{
  local namespace="$1"
  local timeout="$2"
  local command_status
  local deployment
  local deployment_resource
  shift 2
  for deployment in "$@"; do
    if deployment_resource="$(kubectl get "deployment/$deployment" -n "$namespace" --ignore-not-found -o name)"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory database consumer Deployment '$deployment' before restart."
      return "$command_status"
    fi
    if [[ -n "$deployment_resource" ]]; then
      if kubectl rollout restart "deployment/$deployment" -n "$namespace"; then
        command_status=0
      else
        command_status=$?
      fi
      if (( command_status != 0 )); then
        err "Unable to restart database consumer Deployment '$deployment'."
        return "$command_status"
      fi
    fi
  done
  for deployment in "$@"; do
    if deployment_resource="$(kubectl get "deployment/$deployment" -n "$namespace" --ignore-not-found -o name)"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory database consumer Deployment '$deployment' after restart."
      return "$command_status"
    fi
    if [[ -n "$deployment_resource" ]]; then
      if kubectl rollout status "deployment/$deployment" -n "$namespace" --timeout="${timeout}s"; then
        command_status=0
      else
        command_status=$?
      fi
      if (( command_status != 0 )); then
        err "Database consumer Deployment '$deployment' did not complete its restart."
        return "$command_status"
      fi
    fi
  done
}

wait_for_final_deployment_if_present()
{
  local deployment="$1"
  local namespace="${2:-$NAMESPACE}"
  local command_status
  local deployment_resource
  if deployment_resource="$(kubectl get "deployment/$deployment" -n "$namespace" --ignore-not-found -o name)"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Unable to inventory final Deployment '$deployment'."
    return "$command_status"
  fi
  if [[ -z "$deployment_resource" ]]; then
    return 0
  fi
  if kubectl rollout status "deployment/$deployment" -n "$namespace" --timeout="${TIMEOUT}s"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Final Deployment '$deployment' did not complete its rollout."
    return "$command_status"
  fi
}
