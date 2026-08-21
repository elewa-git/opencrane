#!/usr/bin/env bash
# Owns the OpenCrane server fence and the only automatic recovery from a failed post-fence
# database transition.
# The caller supplies manifest-bound globals, classify_database_convergence_state, and log/err.

capture_recovery_command_output()
{
  local output_name="$1"
  local command_output
  local command_status
  shift
  if command_output="$("$@")"; then
    command_status=0
  else
    command_status=$?
  fi
  printf -v "$output_name" '%s' "$command_output"
  return "$command_status"
}

capture_pre_fence_main_release_revision()
{
  local listed_releases
  local release_status
  local status_result
  if release_status="$(helm status "$RELEASE" -n "$NAMESPACE" -o json)"; then
    status_result=0
  else
    status_result=$?
  fi
  if (( status_result != 0 )); then
    if ! listed_releases="$(helm list --namespace "$NAMESPACE" --filter "^${RELEASE}$" --output json)"; then
      err "Unable to determine whether an OpenCrane Helm release exists before migration."
      return 1
    fi
    if ! jq -e 'type == "array" and length == 0' <<<"$listed_releases" >/dev/null; then
      err "OpenCrane Helm release exists but its exact pre-fence revision is unreadable."
      return 1
    fi
    DATABASE_PRE_FENCE_RELEASE_REVISION=""
    log "No main OpenCrane Helm release exists; verified that no pre-fence revision is available."
    return 0
  fi
  if ! DATABASE_PRE_FENCE_RELEASE_REVISION="$(jq -er '.version | select(type == "number" and . > 0) | floor | tostring' \
    <<<"$release_status")"; then
    err "Unable to capture the exact pre-fence OpenCrane Helm revision."
    return 1
  fi
}

fence_existing_opencrane_server()
{
  local command_status
  local prior_release_values
  local server_deployment
  local server_deployment_inventory
  local server_job_inventory
  local server_pod_inventory
  local server_replica_set_inventory
  local fence_deadline
  local desired_replicas
  local deployment_uid
  local live_replicas
  local active_pod_count
  local nonterminal_job_count
  build_membership_helm_args
  server_deployment="${RELEASE}-opencrane-server"
  if ! helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    if ! server_deployment_inventory="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" --ignore-not-found -o name)"; then
      err "Unable to prove whether an orphan OpenCrane server deployment exists before database migration."
      return 1
    fi
    if ! server_pod_inventory="$(kubectl get pods -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server pods exist before database migration."
      return 1
    fi
    if ! server_replica_set_inventory="$(kubectl get replicasets -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server replica sets exist before database migration."
      return 1
    fi
    if ! server_job_inventory="$(kubectl get jobs -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server jobs exist before database migration."
      return 1
    fi
    if [[ -n "$server_deployment_inventory" || -n "$server_pod_inventory" \
      || -n "$server_replica_set_inventory" || -n "$server_job_inventory" ]]; then
      err "OpenCrane server workload exists without its Helm release; database migration cannot prove a write fence."
      return 1
    fi
    return
  fi
  if ! prior_release_values="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json)"; then
    err "Unable to read the existing OpenCrane Helm values before fencing."
    return 1
  fi
  if ! DATABASE_FENCE_PRIOR_REPLICAS="$(jq -er '.migrationFence.previousReplicas // .clustertenantManager.replicas // 1' \
    <<<"$prior_release_values")"; then
    err "Unable to read the previous OpenCrane server replica count."
    return 1
  fi
  if [[ ! "$DATABASE_FENCE_PRIOR_REPLICAS" =~ ^[0-9]+$ || "$DATABASE_FENCE_PRIOR_REPLICAS" == "0" ]]; then
    err "Existing release '$RELEASE' has no recoverable positive server replica count for the database migration fence."
    return 1
  fi
  log "Fencing the existing OpenCrane server through its Helm release before database mutation…"
  if helm upgrade "$RELEASE" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --force-conflicts \
    --reuse-values \
    --set clustertenantManager.replicas=0 \
    --set migrationFence.active=true \
    --set migrationFence.previousReplicas="$DATABASE_FENCE_PRIOR_REPLICAS" \
    --set-string migrationFence.fromReleaseVersion="$FROM_RELEASE_VERSION" \
    --set-string migrationFence.toReleaseVersion="$RELEASE_VERSION" \
    "${MEMBERSHIP_HELM_ARGS[@]}" \
    --wait \
    --timeout "${TIMEOUT}s"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "OpenCrane server Helm fence failed."
    return "$command_status"
  fi
  if capture_recovery_command_output server_deployment_inventory kubectl get deployment "$server_deployment" \
    -n "$NAMESPACE" --ignore-not-found -o name; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Unable to read the fenced OpenCrane server deployment."
    return "$command_status"
  fi
  if [[ -z "$server_deployment_inventory" ]]; then
    err "Helm release '$RELEASE' exists but its server deployment is absent after fencing."
    return 1
  fi
  if capture_recovery_command_output deployment_uid kubectl get deployment "$server_deployment" \
    -n "$NAMESPACE" -o jsonpath='{.metadata.uid}'; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Unable to read the fenced OpenCrane server Deployment UID."
    return "$command_status"
  fi
  [[ -n "$deployment_uid" ]] || { err "Fenced OpenCrane server deployment has no readable UID."; return 1; }
  fence_deadline="$(( $(date +%s) + TIMEOUT ))"
  while true; do
    if capture_recovery_command_output desired_replicas kubectl get deployment "$server_deployment" \
      -n "$NAMESPACE" -o jsonpath='{.spec.replicas}'; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to read the fenced OpenCrane server desired replicas."
      return "$command_status"
    fi
    if capture_recovery_command_output live_replicas kubectl get deployment "$server_deployment" \
      -n "$NAMESPACE" -o jsonpath='{.status.replicas}'; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to read the fenced OpenCrane server live replicas."
      return "$command_status"
    fi
    if capture_recovery_command_output server_pod_inventory kubectl get pods -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" -o json; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory OpenCrane server pods after fencing."
      return "$command_status"
    fi
    if capture_recovery_command_output server_replica_set_inventory kubectl get replicasets -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" -o json; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory OpenCrane server replica sets after fencing."
      return "$command_status"
    fi
    if capture_recovery_command_output server_job_inventory kubectl get jobs -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" -o json; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to inventory OpenCrane server jobs after fencing."
      return "$command_status"
    fi
    if jq -e --arg deployment_uid "$deployment_uid" '
      .items | all(
        (.spec.replicas // 0) == 0
        and any(.metadata.ownerReferences[]?; .kind == "Deployment" and .uid == $deployment_uid)
      )
    ' <<<"$server_replica_set_inventory" >/dev/null; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "A server replica set is foreign-owned or remains scaled above zero after fencing."
      return "$command_status"
    fi
    if active_pod_count="$(jq -er '[.items[] | select(.status.phase == "Pending" or .status.phase == "Running" or .status.phase == "Unknown")] | length' \
      <<<"$server_pod_inventory")"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to classify OpenCrane server pod activity after fencing."
      return "$command_status"
    fi
    if nonterminal_job_count="$(jq -er '[.items[] | select(all(.status.conditions[]?; .type != "Complete" and .type != "Failed"))] | length' \
      <<<"$server_job_inventory")"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to classify OpenCrane server Job activity after fencing."
      return "$command_status"
    fi
    if [[ "$desired_replicas" == "0" && "${live_replicas:-0}" == "0" \
      && "$active_pod_count" == "0" && "$nonterminal_job_count" == "0" ]]; then
      return
    fi
    if [[ "$(date +%s)" -ge "$fence_deadline" ]]; then
      err "OpenCrane server migration fence did not reach zero replicas; database mutation is blocked."
      return 1
    fi
    sleep 2
  done
}

database_migration_job_is_terminal_or_absent()
{
  local command_status
  local migration_job
  if capture_recovery_command_output migration_job kubectl get job "${POSTGRES_RELEASE}-database-migration" \
    -n "$NAMESPACE" --ignore-not-found -o json; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Unable to determine whether the database migration Job is still active."
    return "$command_status"
  fi
  if [[ -z "$migration_job" ]]; then
    return 0
  fi
  if ! jq -e '
    .kind == "Job"
    and ((.status.active // 0) == 0)
    and any(.status.conditions[]?;
      (.type == "Complete" or .type == "Failed") and .status == "True")
  ' <<<"$migration_job" >/dev/null; then
    err "Database migration Job is active or its terminal state is unknown; the server fence remains active."
    return 1
  fi
}

recover_failed_database_transition()
{
  local job_status
  local original_status="$1"
  local classification_status
  local convergence_outcome
  local policy_status
  if [[ "${DATABASE_TEMPORARY_SUPERUSER_ACCESS:-false}" == "true" ]]; then
    if ! revoke_temporary_database_superuser_access; then
      err "Temporary CNPG superuser access could not be revoked; the server fence remains active."
      return "$original_status"
    fi
  fi
  if database_migration_job_is_terminal_or_absent; then
    job_status=0
  else
    job_status=$?
  fi
  if (( job_status != 0 )); then
    return "$original_status"
  fi

  if classify_database_convergence_state; then
    classification_status=0
  else
    classification_status=$?
  fi
  if (( classification_status != 0 )); then
    err "Database state could not be reclassified after failure; the server fence remains active."
    return "$original_status"
  fi
  if convergence_outcome="$(resolve_database_convergence_outcome failed_transition \
    "$DATABASE_LIVE_CONVERGENCE_STATE")"; then
    policy_status=0
  else
    policy_status=$?
  fi
  if (( policy_status != 0 )); then
    err "Database convergence policy rejected the post-failure state; the server fence remains active."
    return "$original_status"
  fi
  case "$convergence_outcome" in
    keep_fence)
      err "Database state is '$DATABASE_LIVE_CONVERGENCE_STATE' after failure; the server fence remains active."
      return "$original_status"
      ;;
    rollback_source) ;;
    *)
      err "Database convergence policy returned an unknown recovery outcome; the server fence remains active."
      return "$original_status"
      ;;
  esac
  if [[ -z "$DATABASE_PRE_FENCE_RELEASE_REVISION" ]]; then
    err "No pre-fence OpenCrane Helm revision exists to roll back; the server remains absent."
    return "$original_status"
  fi
  if ! helm rollback "$RELEASE" "$DATABASE_PRE_FENCE_RELEASE_REVISION" \
    --namespace "$NAMESPACE" \
    --wait \
    --timeout "${TIMEOUT}s" \
    --force-conflicts; then
    err "Rollback to pre-fence Helm revision '$DATABASE_PRE_FENCE_RELEASE_REVISION' failed; the server fence remains active."
    return "$original_status"
  fi
  log "Database remains at the exact source state; restored OpenCrane Helm revision '$DATABASE_PRE_FENCE_RELEASE_REVISION'."
  return "$original_status"
}

run_guarded_post_fence_stage()
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
  recover_failed_database_transition "$stage_status"
}
