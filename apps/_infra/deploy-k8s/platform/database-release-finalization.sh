#!/usr/bin/env bash
# Owns application finalization after the database release transition. It restores the exact fenced
# Helm revision when un-fencing, credential-checksum rolls, rollout waits, certificate readiness, or
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

# Digests the published connection Secrets so the consumer roll below can tell whether the
# credentials the running pods loaded are still current. Credential bytes flow straight from
# kubectl into the digest through the pipe; the deploy shell never holds them in a variable
# or argument.
compute_database_connection_checksum()
{
  local namespace="$1"
  shift
  kubectl get secret "$@" -n "$namespace" \
    -o jsonpath='{range .items[*]}{.metadata.name}{":"}{.data}{"\n"}{end}' \
    | sha256sum | cut -d' ' -f1
}

# Stamps the connection-Secret checksum onto each consumer Deployment's pod template. An
# unchanged checksum is a server-side no-op, so pods the preceding helm upgrade just started
# keep running; a changed checksum triggers exactly one rollout. The previous unconditional
# `rollout restart` here forced a second full startup of the heaviest workloads on every
# deploy, even when no credential changed.
roll_database_consumers_for_finalization()
{
  local namespace="$1"
  local timeout="$2"
  local checksum="$3"
  local command_status
  local deployment
  local deployment_resource
  shift 3
  for deployment in "$@"; do
    if deployment_resource="$(kubectl get "deployment/$deployment" -n "$namespace" --ignore-not-found -o name)"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory database consumer Deployment '$deployment' before the credential roll."
      return "$command_status"
    fi
    if [[ -n "$deployment_resource" ]]; then
      if kubectl patch "deployment/$deployment" -n "$namespace" --type merge \
        -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"opencrane.ai/database-connection-checksum\":\"$checksum\"}}}}}"; then
        command_status=0
      else
        command_status=$?
      fi
      if (( command_status != 0 )); then
        err "Unable to stamp the database connection checksum on Deployment '$deployment'."
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
      err "Unable to inventory database consumer Deployment '$deployment' after the credential roll."
      return "$command_status"
    fi
    if [[ -n "$deployment_resource" ]]; then
      if kubectl rollout status "deployment/$deployment" -n "$namespace" --timeout="${timeout}s"; then
        command_status=0
      else
        command_status=$?
      fi
      if (( command_status != 0 )); then
        err "Database consumer Deployment '$deployment' did not complete its credential roll."
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
