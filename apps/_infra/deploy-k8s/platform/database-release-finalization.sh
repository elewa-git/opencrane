#!/usr/bin/env bash
# Owns the ordinary application finalization after PostgreSQL reconciliation.

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
    | LC_ALL=C sort | sha256sum | cut -d' ' -f1
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
