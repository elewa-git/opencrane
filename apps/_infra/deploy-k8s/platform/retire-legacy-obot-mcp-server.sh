#!/usr/bin/env bash

_LEGACY_OBOT_HASH="db3d4e4b60f0b6f402e41dfef18e4ecb2cfb49eb"
_LEGACY_OBOT_OWNER="sms1obot-mcp-server"

# Checks minReadySeconds when requested, then waits for the Deployment and verifies its image.
_require_legacy_obot_replacement_deployment()
{
  local namespace="$1"
  local deployment="$2"
  local expected_image="$3"
  local timeout="$4"
  local minimum_ready_seconds="${5:-}"
  local live_image
  local live_minimum_ready_seconds
  if [[ -n "$minimum_ready_seconds" ]]; then
    live_minimum_ready_seconds="$(kubectl get "deployment/$deployment" --namespace "$namespace" -o 'jsonpath={.spec.minReadySeconds}' --request-timeout="${timeout}s")" || return 1
    if [[ ! "$live_minimum_ready_seconds" =~ ^[0-9]+$ ]]; then
      err "Replacement Deployment '$deployment' does not declare minReadySeconds, so the retired Obot server remains in place."
      return 1
    fi
    if (( 10#$live_minimum_ready_seconds < minimum_ready_seconds )); then
      err "Replacement Deployment '$deployment' declares minReadySeconds=$live_minimum_ready_seconds; at least $minimum_ready_seconds seconds are required before Obot retirement."
      return 1
    fi
  fi
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
  _require_legacy_obot_replacement_deployment "$namespace" "${release}-agent-controller" "$controller_image" "$timeout" 10 || return 1
  _require_legacy_obot_replacement_deployment "$scanner_namespace" "${release}-artifact-scanner" "$scanner_image" "$timeout" 10 || return 1
  _require_legacy_obot_replacement_deployment "$personal_runtime_namespace" "${release}-personal-warm" "$runtime_image" "$timeout" || return 1
  _require_legacy_obot_replacement_deployment "$managed_runtime_namespace" "${release}-managed-warm" "$runtime_image" "$timeout" || return 1
}

# Returns the Kubernetes API path for one named legacy resource.
_legacy_obot_api_path()
{
  local resource="$1"
  local namespace="$2"
  local name="${resource#*/}"
  case "${resource%%/*}" in
    deployment) printf '/apis/apps/v1/namespaces/%s/deployments/%s' "$namespace" "$name" ;;
    database.postgresql.cnpg.io) printf '/apis/postgresql.cnpg.io/v1/namespaces/%s/databases/%s' "$namespace" "$name" ;;
    service) printf '/api/v1/namespaces/%s/services/%s' "$namespace" "$name" ;;
    secret) printf '/api/v1/namespaces/%s/secrets/%s' "$namespace" "$name" ;;
    *) return 1 ;;
  esac
}

# Reads the retired database and login counts from the current PostgreSQL primary.
_legacy_obot_postgres_counts()
{
  local namespace="$1"
  local release="$2"
  local timeout="$3"
  local primary_pod
  local counts
  primary_pod="$(kubectl get pod --namespace "$namespace" --selector "cnpg.io/cluster=${release}-postgres,role=primary" -o 'jsonpath={.items[0].metadata.name}' --request-timeout="${timeout}s")" || return 1
  if [[ -z "$primary_pod" ]]; then
    err "The PostgreSQL primary for '$release' is unavailable, so Obot database retirement cannot be proved."
    return 1
  fi
  counts="$(kubectl exec "$primary_pod" --namespace "$namespace" --container postgres --request-timeout="${timeout}s" -- \
    psql --dbname=postgres --username=postgres --tuples-only --no-align \
    --command "SELECT (SELECT count(*) FROM pg_database WHERE datname = 'obot') || ' ' || (SELECT count(*) FROM pg_roles WHERE rolname = 'obot');")" || return 1
  printf '%s' "$counts"
}

# Proves the retired logical database is absent from the current PostgreSQL primary.
_prove_legacy_obot_database_absent()
{
  local namespace="$1"
  local release="$2"
  local timeout="$3"
  local counts
  local database_count
  counts="$(_legacy_obot_postgres_counts "$namespace" "$release" "$timeout")" || return 1
  database_count="${counts%% *}"
  if [[ "$database_count" != "0" ]]; then
    err "The retired Obot logical database is still present in PostgreSQL."
    return 1
  fi
}

# Removes the retired Obot login through a temporary managed-role tombstone.
_retire_legacy_obot_database_role()
{
  local namespace="$1"
  local release="$2"
  local timeout="$3"
  local cluster_resource="cluster.postgresql.cnpg.io/${release}-postgres"
  local counts
  local role_count
  local cluster_metadata
  local cluster_name
  local cluster_uid
  local cluster_resource_version
  local cluster_managed_by
  local cluster_release_name
  local cluster_release_namespace
  local cluster_json
  local role_count_in_spec
  local role_index
  local role_ensure
  local deadline

  counts="$(_legacy_obot_postgres_counts "$namespace" "$release" "$timeout")" || return 1
  role_count="${counts##* }"
  if [[ "$role_count" == "0" ]]; then
    return 0
  fi
  if [[ "$role_count" != "1" ]]; then
    err "The retired Obot login has an unexpected PostgreSQL role count."
    return 1
  fi

  cluster_metadata="$(kubectl get "$cluster_resource" --namespace "$namespace" \
    -o 'custom-columns=NAME:.metadata.name,UID:.metadata.uid,RV:.metadata.resourceVersion,MANAGED:.metadata.labels.app\.kubernetes\.io/managed-by,RELEASE:.metadata.annotations.meta\.helm\.sh/release-name,RELEASE_NS:.metadata.annotations.meta\.helm\.sh/release-namespace' \
    --no-headers --request-timeout="${timeout}s")" || return 1
  read -r cluster_name cluster_uid cluster_resource_version cluster_managed_by cluster_release_name cluster_release_namespace <<<"$cluster_metadata"
  if [[ "$cluster_name" != "${release}-postgres" || -z "$cluster_uid" || "$cluster_uid" == "<none>" \
    || -z "$cluster_resource_version" || "$cluster_resource_version" == "<none>" \
    || "$cluster_managed_by" != "Helm" || "$cluster_release_name" != "${release}-postgres" \
    || "$cluster_release_namespace" != "$namespace" ]]; then
    err "Refusing to retire the Obot login; the PostgreSQL Cluster ownership does not match this release."
    return 1
  fi

  cluster_json="$(kubectl get "$cluster_resource" --namespace "$namespace" -o json --request-timeout="${timeout}s")" || return 1
  role_count_in_spec="$(jq '[.spec.managed.roles[]? | select(.name == "obot")] | length' <<<"$cluster_json")" || return 1
  if [[ "$role_count_in_spec" == "0" ]]; then
    kubectl patch "$cluster_resource" --namespace "$namespace" --type json \
      --patch "[{\"op\":\"test\",\"path\":\"/metadata/resourceVersion\",\"value\":\"${cluster_resource_version}\"},{\"op\":\"add\",\"path\":\"/spec/managed/roles/-\",\"value\":{\"name\":\"obot\",\"ensure\":\"absent\"}}]" \
      --request-timeout="${timeout}s" >/dev/null || return 1
  elif [[ "$role_count_in_spec" == "1" ]]; then
    role_index="$(jq -r '.spec.managed.roles | to_entries[] | select(.value.name == "obot") | .key' <<<"$cluster_json")" || return 1
    kubectl patch "$cluster_resource" --namespace "$namespace" --type json \
      --patch "[{\"op\":\"test\",\"path\":\"/metadata/resourceVersion\",\"value\":\"${cluster_resource_version}\"},{\"op\":\"replace\",\"path\":\"/spec/managed/roles/${role_index}\",\"value\":{\"name\":\"obot\",\"ensure\":\"absent\"}}]" \
      --request-timeout="${timeout}s" >/dev/null || return 1
  else
    err "Refusing to retire the Obot login; the PostgreSQL Cluster declares it more than once."
    return 1
  fi

  deadline=$((SECONDS + timeout))
  while (( SECONDS <= deadline )); do
    counts="$(_legacy_obot_postgres_counts "$namespace" "$release" "$timeout")" || return 1
    role_count="${counts##* }"
    if [[ "$role_count" == "0" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "$role_count" != "0" ]]; then
    err "Timed out while CloudNativePG retired the Obot login."
    return 1
  fi

  cluster_json="$(kubectl get "$cluster_resource" --namespace "$namespace" -o json --request-timeout="${timeout}s")" || return 1
  if [[ "$(jq -r '.metadata.uid' <<<"$cluster_json")" != "$cluster_uid" ]]; then
    err "The PostgreSQL Cluster changed identity during Obot role retirement."
    return 1
  fi
  cluster_resource_version="$(jq -r '.metadata.resourceVersion' <<<"$cluster_json")" || return 1
  role_count_in_spec="$(jq '[.spec.managed.roles[]? | select(.name == "obot")] | length' <<<"$cluster_json")" || return 1
  role_index="$(jq -r '.spec.managed.roles | to_entries[] | select(.value.name == "obot") | .key' <<<"$cluster_json")" || return 1
  role_ensure="$(jq -r --argjson index "$role_index" '.spec.managed.roles[$index].ensure' <<<"$cluster_json")" || return 1
  if [[ "$role_count_in_spec" != "1" || "$role_ensure" != "absent" ]]; then
    err "The PostgreSQL Cluster lost the exact Obot role tombstone before cleanup."
    return 1
  fi
  kubectl patch "$cluster_resource" --namespace "$namespace" --type json \
    --patch "[{\"op\":\"test\",\"path\":\"/metadata/resourceVersion\",\"value\":\"${cluster_resource_version}\"},{\"op\":\"test\",\"path\":\"/spec/managed/roles/${role_index}/name\",\"value\":\"obot\"},{\"op\":\"test\",\"path\":\"/spec/managed/roles/${role_index}/ensure\",\"value\":\"absent\"},{\"op\":\"remove\",\"path\":\"/spec/managed/roles/${role_index}\"}]" \
    --request-timeout="${timeout}s" >/dev/null || return 1
}

# Waits for CloudNativePG to apply the exact ensure-absent generation.
_wait_for_legacy_obot_database_absence()
{
  local resource="$1"
  local namespace="$2"
  local expected_uid="$3"
  local timeout="$4"
  local deadline=$((SECONDS + timeout))
  local metadata
  local uid
  local generation
  local observed_generation
  local applied
  local ensure
  while (( SECONDS <= deadline )); do
    metadata="$(kubectl get "$resource" --namespace "$namespace" --ignore-not-found \
      -o 'custom-columns=UID:.metadata.uid,GEN:.metadata.generation,OBSERVED:.status.observedGeneration,APPLIED:.status.applied,ENSURE:.spec.ensure' \
      --no-headers --request-timeout="${timeout}s")" || return 1
    if [[ -z "$metadata" ]]; then
      err "The Obot Database authority disappeared before logical database absence was proved."
      return 1
    fi
    read -r uid generation observed_generation applied ensure <<<"$metadata"
    if [[ "$uid" != "$expected_uid" ]]; then
      err "The Obot Database authority changed identity during retirement."
      return 1
    fi
    if [[ "$ensure" == "absent" && "$observed_generation" == "$generation" && "$applied" == "true" ]]; then
      return 0
    fi
    sleep 1
  done
  err "Timed out while CloudNativePG retired the Obot logical database."
  return 1
}

# Removes retained Obot database custody after proving every object belongs to the retired path.
retire_legacy_obot_database_custody()
{
  local namespace="$1"
  local release="$2"
  local timeout="$3"
  local database_resource="database.postgresql.cnpg.io/${release}-postgres-obot"
  local database_metadata
  local database_name
  local database_uid
  local database_resource_version
  local database_managed_by
  local database_chart
  local database_release_name
  local database_release_namespace
  local database_cluster
  local logical_database_name
  local logical_database_owner
  local database_ensure
  local database_reclaim_policy
  local secret
  local secret_metadata
  local secret_name
  local secret_uid
  local secret_resource_version
  local secret_type
  local secret_managed_by
  local credential_source
  local owner_uid
  local found=0
  local database_found=0
  local proven_secrets=()
  local proven_secret_uids=()
  local proven_secret_resource_versions=()

  if [[ ! "$timeout" =~ ^[1-9][0-9]*$ ]]; then
    err "Obot custody retirement requires a positive timeout in seconds."
    return 1
  fi

  database_metadata="$(kubectl get "$database_resource" --namespace "$namespace" --ignore-not-found \
    -o 'custom-columns=NAME:.metadata.name,UID:.metadata.uid,RV:.metadata.resourceVersion,MANAGED:.metadata.labels.app\.kubernetes\.io/managed-by,CHART:.metadata.labels.helm\.sh/chart,RELEASE:.metadata.annotations.meta\.helm\.sh/release-name,RELEASE_NS:.metadata.annotations.meta\.helm\.sh/release-namespace,CLUSTER:.spec.cluster.name,DB:.spec.name,OWNER:.spec.owner,ENSURE:.spec.ensure,RECLAIM:.spec.databaseReclaimPolicy' \
    --no-headers --request-timeout="${timeout}s")" || return 1
  if [[ -n "$database_metadata" ]]; then
    read -r database_name database_uid database_resource_version database_managed_by database_chart database_release_name database_release_namespace database_cluster logical_database_name logical_database_owner database_ensure database_reclaim_policy <<<"$database_metadata"
    if [[ "$database_name" != "${release}-postgres-obot" || -z "$database_uid" || "$database_uid" == "<none>" \
      || -z "$database_resource_version" || "$database_resource_version" == "<none>" \
      || "$database_managed_by" != "Helm" \
      || ( "$database_chart" != "postgres-0.9.1" && "$database_chart" != "postgres-0.9.3" ) \
      || "$database_release_name" != "${release}-postgres" || "$database_release_namespace" != "$namespace" \
      || "$database_cluster" != "${release}-postgres" || "$logical_database_name" != "obot" \
      || "$logical_database_owner" != "obot" || ( "$database_ensure" != "present" && "$database_ensure" != "absent" ) \
      || "$database_reclaim_policy" != "retain" ]]; then
      err "Refusing to retire '$database_resource'; its ownership or logical database contract does not match the retired Obot path."
      return 1
    fi
    database_found=1
    found=$((found + 1))
  fi

  for secret in "secret/${release}-obot" "secret/${release}-postgres-obot-app"; do
    secret_metadata="$(kubectl get "$secret" --namespace "$namespace" --ignore-not-found \
      -o 'custom-columns=NAME:.metadata.name,UID:.metadata.uid,RV:.metadata.resourceVersion,TYPE:.type,MANAGED:.metadata.labels.app\.kubernetes\.io/managed-by,SOURCE:.metadata.annotations.opencrane\.ai/credential-source,OWNER_UID:.metadata.ownerReferences[0].uid' \
      --no-headers --request-timeout="${timeout}s")" || return 1
    if [[ -z "$secret_metadata" ]]; then
      continue
    fi
    read -r secret_name secret_uid secret_resource_version secret_type secret_managed_by credential_source owner_uid <<<"$secret_metadata"
    if [[ "$secret_name" != "${secret#*/}" || -z "$secret_uid" || "$secret_uid" == "<none>" \
      || -z "$secret_resource_version" || "$secret_resource_version" == "<none>" || "$secret_type" != "Opaque" \
      || ( -n "$owner_uid" && "$owner_uid" != "<none>" ) ]]; then
      err "Refusing to retire '$secret'; its identity does not match the generated Obot custody object."
      return 1
    fi
    if [[ "$secret" == "secret/${release}-postgres-obot-app" ]]; then
      if [[ "$secret_managed_by" != "opencrane-postgres" || "$credential_source" != "${release}-obot-postgres-bootstrap" ]]; then
        err "Refusing to retire '$secret'; its PostgreSQL publisher ownership does not match."
        return 1
      fi
    elif [[ ( -n "$secret_managed_by" && "$secret_managed_by" != "<none>" ) \
      || ( -n "$credential_source" && "$credential_source" != "<none>" ) ]]; then
      err "Refusing to retire '$secret'; the legacy adapter unexpectedly declares another owner."
      return 1
    fi
    proven_secrets+=("$secret")
    proven_secret_uids+=("$secret_uid")
    proven_secret_resource_versions+=("$secret_resource_version")
    found=$((found + 1))
  done

  if (( database_found == 1 )); then
    if [[ "$database_ensure" != "absent" ]]; then
      kubectl patch "$database_resource" --namespace "$namespace" --type merge \
        --patch "{\"metadata\":{\"resourceVersion\":\"${database_resource_version}\"},\"spec\":{\"ensure\":\"absent\"}}" \
        --request-timeout="${timeout}s" >/dev/null || return 1
    fi
    _wait_for_legacy_obot_database_absence "$database_resource" "$namespace" "$database_uid" "$timeout" || return 1
  fi
  _prove_legacy_obot_database_absent "$namespace" "$release" "$timeout" || return 1
  _retire_legacy_obot_database_role "$namespace" "$release" "$timeout" || return 1

  if (( found == 0 )); then
    log "The retired Obot database custody is already absent from namespace '$namespace'."
    return 0
  fi

  if (( database_found == 1 )); then
    database_metadata="$(kubectl get "$database_resource" --namespace "$namespace" \
      -o 'custom-columns=UID:.metadata.uid,RV:.metadata.resourceVersion' --no-headers \
      --request-timeout="${timeout}s")" || return 1
    read -r secret_uid database_resource_version <<<"$database_metadata"
    if [[ "$secret_uid" != "$database_uid" || -z "$database_resource_version" || "$database_resource_version" == "<none>" ]]; then
      err "Refusing to delete '$database_resource'; it changed after absence was proved."
      return 1
    fi
    _delete_legacy_obot_resource "$database_resource" "$namespace" "$database_uid" "$database_resource_version" "$timeout" || return 1
  fi

  local index
  for ((index = 0; index < ${#proven_secrets[@]}; index++)); do
    _delete_legacy_obot_resource "${proven_secrets[$index]}" "$namespace" "${proven_secret_uids[$index]}" "${proven_secret_resource_versions[$index]}" "$timeout" || return 1
  done
  log "Retired the legacy Obot database custody from namespace '$namespace'; the external bootstrap Secret remains operator-owned."
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
