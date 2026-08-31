#!/usr/bin/env bash

_LEGACY_OBOT_HASH="db3d4e4b60f0b6f402e41dfef18e4ecb2cfb49eb"
_LEGACY_OBOT_OWNER="sms1obot-mcp-server"

# Waits for a required replacement Deployment and checks the image that became ready.
_require_legacy_obot_replacement_deployment()
{
  local namespace="$1"
  local deployment="$2"
  local expected_image="$3"
  local timeout="$4"
  local live_image
  if ! kubectl rollout status "deployment/$deployment" --namespace "$namespace" --timeout="${timeout}s"; then
    err "Replacement Deployment '$deployment' is not ready, so the retired Obot server remains in place."
    return 1
  fi
  live_image="$(kubectl get "deployment/$deployment" --namespace "$namespace" -o 'jsonpath={.spec.template.spec.containers[0].image}' --request-timeout="${timeout}s")" || return 1
  if [[ "$live_image" != "$expected_image" ]]; then
    err "Replacement Deployment '$deployment' runs '$live_image' instead of '$expected_image'."
    return 1
  fi
}

# Proves every standing 0.10 replacement Deployment before the deploy removes the Obot server.
verify_legacy_obot_replacement_ready()
{
  local namespace="$1"
  local release="$2"
  local timeout="$3"
  local server_image="$4"
  local controller_image="$5"
  local scanner_image="$6"
  local runtime_image="$7"
  local scanner_namespace="$8"
  local personal_runtime_namespace="$9"
  local managed_runtime_namespace="${10}"
  _require_legacy_obot_replacement_deployment "$namespace" "${release}-opencrane-server" "$server_image" "$timeout" || return 1
  _require_legacy_obot_replacement_deployment "$namespace" "${release}-agent-controller" "$controller_image" "$timeout" || return 1
  _require_legacy_obot_replacement_deployment "$scanner_namespace" "${release}-artifact-scanner" "$scanner_image" "$timeout" || return 1
  _require_legacy_obot_replacement_deployment "$personal_runtime_namespace" "${release}-personal-warm" "$runtime_image" "$timeout" || return 1
  _require_legacy_obot_replacement_deployment "$managed_runtime_namespace" "${release}-managed-warm" "$runtime_image" "$timeout" || return 1
}

# Returns the Kubernetes API path for one of the six named legacy resources.
_legacy_obot_api_path()
{
  local resource="$1"
  local namespace="$2"
  local name="${resource#*/}"
  case "${resource%%/*}" in
    deployment) printf '/apis/apps/v1/namespaces/%s/deployments/%s' "$namespace" "$name" ;;
    service) printf '/api/v1/namespaces/%s/services/%s' "$namespace" "$name" ;;
    secret) printf '/api/v1/namespaces/%s/secrets/%s' "$namespace" "$name" ;;
    *) return 1 ;;
  esac
}

# Waits until the proven UID is absent without treating a same-name replacement as the old object.
_wait_for_legacy_obot_uid_retirement()
{
  local resource="$1"
  local namespace="$2"
  local retired_uid="$3"
  local timeout="$4"
  local deadline=$((SECONDS + timeout))
  local current_uid
  while (( SECONDS <= deadline )); do
    if ! current_uid="$(kubectl get "$resource" --namespace "$namespace" --ignore-not-found -o 'jsonpath={.metadata.uid}' --request-timeout="${timeout}s" 2>/dev/null)"; then
      err "Unable to confirm retirement of '$resource' in namespace '$namespace'."
      return 1
    fi
    if [[ -z "$current_uid" || "$current_uid" != "$retired_uid" ]]; then
      return 0
    fi
    sleep 1
  done
  err "Timed out while retiring '$resource' from namespace '$namespace'."
  return 1
}

# Deletes one proven object through UID and resource-version preconditions.
_delete_legacy_obot_resource()
{
  local resource="$1"
  local namespace="$2"
  local uid="$3"
  local resource_version="$4"
  local timeout="$5"
  local api_path
  local current_uid
  local current_resource_version
  local current_metadata
  local delete_options
  api_path="$(_legacy_obot_api_path "$resource" "$namespace")" || return 1
  printf -v delete_options '{"apiVersion":"v1","kind":"DeleteOptions","preconditions":{"uid":"%s","resourceVersion":"%s"}}' "$uid" "$resource_version"
  if ! kubectl delete --raw "$api_path" -f - --request-timeout="${timeout}s" <<<"$delete_options" >/dev/null; then
    current_metadata="$(kubectl get "$resource" --namespace "$namespace" --ignore-not-found -o 'custom-columns=UID:.metadata.uid,RV:.metadata.resourceVersion' --no-headers --request-timeout="${timeout}s" 2>/dev/null)" || return 1
    if [[ -z "$current_metadata" ]]; then
      return 0
    fi
    read -r current_uid current_resource_version <<<"$current_metadata"
    if [[ "$current_uid" != "$uid" ]]; then
      err "Refusing to delete '$resource'; its UID changed after ownership was proved."
    elif [[ "$current_resource_version" != "$resource_version" ]]; then
      err "Refusing to delete '$resource'; it changed after ownership was proved."
    else
      err "The identity-preconditioned delete request for '$resource' failed."
    fi
    return 1
  fi
  _wait_for_legacy_obot_uid_retirement "$resource" "$namespace" "$uid" "$timeout"
}

# Removes the six resources created for the retired Obot MCP server after proving their Acorn owner.
retire_legacy_obot_mcp_server_resources()
{
  local namespace="$1"
  local timeout="$2"
  local resource
  local resource_metadata
  local expected_name
  local name
  local uid
  local resource_version
  local hash
  local owner
  local found=0
  local resources=(
    deployment/sms1obot-mcp-server
    service/sms1obot-mcp-server
    secret/sms1obot-mcp-server-mcp-config
    secret/sms1obot-mcp-server-mcp-config-shim
    secret/sms1obot-mcp-server-mcp-files
    secret/sms1obot-mcp-server-mcp-run-shim)
  local proven_resources=()
  local proven_uids=()
  local proven_resource_versions=()

  if [[ ! "$timeout" =~ ^[1-9][0-9]*$ ]]; then
    err "Obot retirement requires a positive timeout in seconds."
    return 1
  fi

  for resource in "${resources[@]}"; do
    if ! resource_metadata="$(kubectl get "$resource" --namespace "$namespace" --ignore-not-found -o 'custom-columns=NAME:.metadata.name,UID:.metadata.uid,RV:.metadata.resourceVersion,HASH:.metadata.labels.apply\.acorn\.io/hash,OWNER:.metadata.annotations.apply\.acorn\.io/owner-sub-context' --no-headers --request-timeout="${timeout}s" 2>/dev/null)"; then
      err "Unable to inspect retired Obot resource '$resource' in namespace '$namespace'."
      return 1
    fi
    if [[ -z "$resource_metadata" ]]; then
      continue
    fi
    expected_name="${resource#*/}"
    read -r name uid resource_version hash owner <<<"$resource_metadata"
    if [[ "$name" != "$expected_name" || "$uid" == "<none>" || -z "$uid" || "$resource_version" == "<none>" || -z "$resource_version" || "$hash" != "$_LEGACY_OBOT_HASH" || "$owner" != "$_LEGACY_OBOT_OWNER" ]]; then
      err "Refusing to retire '$resource'; its Acorn ownership does not match the retired Obot server."
      return 1
    fi
    proven_resources[found]="$resource"
    proven_uids[found]="$uid"
    proven_resource_versions[found]="$resource_version"
    found=$((found + 1))
  done

  if (( found == 0 )); then
    log "The retired Obot MCP server is already absent from namespace '$namespace'."
    return 0
  fi
  local index
  for ((index = 0; index < found; index++)); do
    _delete_legacy_obot_resource "${proven_resources[$index]}" "$namespace" "${proven_uids[$index]}" "${proven_resource_versions[$index]}" "$timeout" || return 1
  done
  log "Retired the legacy Obot MCP server resources from namespace '$namespace'."
}
