#!/usr/bin/env bash
# Deploy-owned sequencing for the PostgreSQL release. The caller supplies resolved,
# manifest-bound globals plus log/err functions. This module may fence the application Helm release
# and reconcile the app-owned PostgreSQL chart; it never selects a migration or edits database bytes.

# Reports whether the deployer can ask the operator for a backup choice.
database_backup_prompt_is_interactive()
{
  [[ -t 0 ]]
}

# Resolves the operator's recovery-backup choice before the deployer contacts the cluster.
resolve_database_backup_requirement()
{
  local response
  if [[ "$DATABASE_TRANSITION_KIND" != "migration" ]]; then
    if [[ "${ALLOW_UNBACKED_DATABASE_MIGRATION:-0}" == "1" ]]; then
      err "--allow-unbacked-database-migration applies only to a real database migration."
      return 2
    fi
    return 0
  fi
  if [[ "${ALLOW_UNBACKED_DATABASE_MIGRATION:-0}" == "1" ]]; then return 0; fi
  if ! database_backup_prompt_is_interactive; then return 0; fi
  while true; do
    printf 'Create a recovery backup before the database migration? [Y/n] ' >&2
    if ! IFS= read -r response; then
      err "Unable to read the backup choice; requiring recovery backup."
      return 0
    fi
    case "$response" in
      ""|y|Y|yes|Yes|YES) return 0 ;;
      n|N|no|No|NO)
        ALLOW_UNBACKED_DATABASE_MIGRATION="1"
        return 0
        ;;
      *) err "Answer yes or no." ;;
    esac
  done
}

build_postgres_release_args()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  local job_deadline_grace_seconds=30
  local helm_status_propagation_grace_seconds=30
  local helm_timeout_seconds="$((TIMEOUT + job_deadline_grace_seconds + helm_status_propagation_grace_seconds))"
  local pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}}]'
  local databases_json="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"}]"
  POSTGRES_ARGS=(upgrade --install "$POSTGRES_RELEASE" "$POSTGRES_CHART_DIR"
    --namespace "$NAMESPACE"
    --set-string "image=$POSTGRES_OPERAND_IMAGE"
    --set-json "databases=$databases_json"
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME"
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET"
    --set-string "bootstrap.targetBaseline.sha256=$POSTGRES_BOOTSTRAP_BASELINE_SHA256"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY"

    --set "superuserAccess.enabled=${POSTGRES_SUPERUSER_ACCESS_ENABLED:-false}"
    --set-string "convergence.targetSchemaVersion=$DATABASE_TARGET_SCHEMA_VERSION"
    --set-string "convergence.targetBaselineSha256=$DATABASE_TARGET_BASELINE_SHA256"
    --set-string "convergence.currentProtectedBaselineSha256=$POSTGRES_BASELINE_SHA256"
    --set "convergence.previousMigration.available=$DATABASE_PREVIOUS_MIGRATION_AVAILABLE"
    --set-string "convergence.previousMigration.id=$DATABASE_PREVIOUS_MIGRATION_ID"
    --set-string "convergence.previousMigration.fromSchemaVersion=$DATABASE_PREVIOUS_SCHEMA_VERSION"
    --set-string "convergence.previousMigration.sourceTargetBaselineSha256=${DATABASE_PREVIOUS_TARGET_BASELINE_SHA256:-}"
    --set-json "convergence.previousMigration.sourceProtectedBaselineSha256s=${DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON:-[]}"
    --set-string "convergence.previousMigration.selectedSourceProtectedBaselineSha256=${DATABASE_SELECTED_PROTECTED_BASELINE_SHA256:-}"
    --set-string "convergence.previousMigration.sqlSha256=$DATABASE_PREVIOUS_MIGRATION_SQL_SHA256"
    --set "migration.enabled=$migration_enabled"
    --set "migration.privilegedExtension.enabled=${DATABASE_PRIVILEGED_EXTENSION_ENABLED:-false}"
    --set-string "migration.privilegedExtension.name=${DATABASE_PRIVILEGED_EXTENSION:-}"
    --set "privileges.enabled=$privileges_enabled"
    --set-json "pooler.clientPodSelectors=$pooler_client_selectors_json"
    --wait
    --timeout "${helm_timeout_seconds}s"
    "${POSTGRES_KUBERNETES_API_ARGS[@]}")
  if [[ "$migration_enabled" == "true" ]]; then
    POSTGRES_ARGS+=(
      --set "migration.timeoutSeconds=$TIMEOUT"
      --set "migration.jobDeadlineGraceSeconds=$job_deadline_grace_seconds"
      --set-string "migration.image=$POSTGRES_MIGRATION_IMAGE"
      --set-string "migration.siloId=$DATABASE_MIGRATION_SILO_ID"
      --set-string "migration.oidcIssuer=$OIDC_ISSUER_URL"
      --set-string "migration.configMap.name=$DATABASE_MIGRATION_CONFIG_MAP"
      --set-string "migration.configMap.key=migration.sql")
  fi
  if [[ "$privileges_enabled" == "true" ]]; then
    POSTGRES_ARGS+=(
      --set "privileges.timeoutSeconds=$TIMEOUT"
      --set "privileges.jobDeadlineGraceSeconds=$job_deadline_grace_seconds")
  fi
  [[ -n "$POSTGRES_VALUES_FILE" ]] && POSTGRES_ARGS+=(--values "$POSTGRES_VALUES_FILE")
  [[ -n "$STORAGE_CLASS" ]] && POSTGRES_ARGS+=(--set-string "storage.storageClass=$STORAGE_CLASS")
  if helm status "$POSTGRES_RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    POSTGRES_ARGS+=(--reset-then-reuse-values)
  fi
}

# Revokes the migration-scoped superuser credential and proves no credential remains.
revoke_temporary_database_superuser_access()
{
  if [[ "${DATABASE_TEMPORARY_SUPERUSER_ACCESS:-false}" != "true" ]]; then
    return 0
  fi
  POSTGRES_SUPERUSER_ACCESS_ENABLED=false
  DATABASE_PRIVILEGED_EXTENSION_ENABLED=false
  if ! install_postgres_release false false; then
    err "Unable to disable temporary CNPG superuser access after the privileged migration step."
    return 1
  fi
  if ! verify_database_superuser_access_disabled; then
    return 1
  fi
  DATABASE_TEMPORARY_SUPERUSER_ACCESS=false
}

postgres_release_render_has_recovery()
{
  local argument
  local render_args=()
  build_postgres_release_args false false
  for argument in "${POSTGRES_ARGS[@]:4}"; do
    [[ "$argument" == "--reset-then-reuse-values" ]] && continue
    render_args+=("$argument")
  done
  helm template "$POSTGRES_RELEASE" "$POSTGRES_CHART_DIR" "${render_args[@]}" \
    --show-only templates/cluster.yaml | grep -q '^    recovery:'
}

install_postgres_release()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  local command_status
  local database_resource
  build_postgres_release_args "$migration_enabled" "$privileges_enabled"

  log "Reconciling PostgreSQL server while preserving bootstrap origin '$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP'…"
  if helm "${POSTGRES_ARGS[@]}"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "PostgreSQL Helm reconciliation failed."
    return "$command_status"
  fi
  if kubectl wait --for=condition=Ready "cluster/${POSTGRES_RELEASE}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "PostgreSQL Cluster did not become Ready."
    return "$command_status"
  fi
  if kubectl wait --for=create "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "PostgreSQL pooler Deployment was not created."
    return "$command_status"
  fi
  if kubectl wait --for=condition=available "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "PostgreSQL pooler Deployment did not become Available."
    return "$command_status"
  fi
  for database_resource in "${POSTGRES_RELEASE}-obot" "${POSTGRES_RELEASE}-litellm"; do
    if kubectl wait --for=jsonpath='{.status.applied}'=true "database/${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Database resource '$database_resource' was not applied."
      return "$command_status"
    fi
  done
  if [[ "$migration_enabled" == "true" ]]; then
    if kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-migration" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Database migration Job did not complete."
      return "$command_status"
    fi
  fi
  if [[ "$privileges_enabled" == "true" ]]; then
    if kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Database privilege Job did not complete."
      return "$command_status"
    fi
  fi
}

classify_database_convergence_state()
{
  local classification_status classification_output
  if classification_output="$(classify_live_database_convergence)"; then
    classification_status=0
  else
    classification_status=$?
  fi
  if (( classification_status != 0 )); then
    err "Unable to read unambiguous live database convergence evidence."
    return "$classification_status"
  fi
  if [[ ! "$classification_output" =~ ^(current|completed|source)\|([0-9a-f]{64})$ \
    && ! "$classification_output" =~ ^incompatible\|([0-9a-f]{64})?$ ]]; then
    err "Database convergence classifier returned an invalid or ambiguous state."
    return 1
  fi
  DATABASE_LIVE_CONVERGENCE_STATE="${classification_output%%|*}"
  DATABASE_SELECTED_PROTECTED_BASELINE_SHA256="${classification_output#*|}"
  if ! database_convergence_state_is_valid "$DATABASE_LIVE_CONVERGENCE_STATE"; then
    err "Database convergence classifier returned an invalid or ambiguous state."
    return 1
  fi
}

publish_database_migration_config_map()
{
  local publisher_status
  local published_config_map
  if published_config_map="$(bash "$POSTGRES_MIGRATION_PUBLISHER" \
    "$NAMESPACE" "$DATABASE_PREVIOUS_MIGRATION_ID" "$DATABASE_MIGRATION_SQL_FILE" \
    "$DATABASE_PREVIOUS_MIGRATION_SQL_SHA256")"; then
    publisher_status=0
  else
    publisher_status=$?
  fi
  if (( publisher_status != 0 )); then
    err "Unable to publish the exact reviewed database migration SQL."
    return "$publisher_status"
  fi
  if [[ -z "$published_config_map" ]]; then
    err "Database migration SQL publisher returned no immutable ConfigMap name."
    return 1
  fi
  DATABASE_MIGRATION_CONFIG_MAP="$published_config_map"
}

adopt_matching_existing_database_fence()
{
  local active_fence
  local command_status
  local listed_releases
  local release_values
  local release_status
  if release_status="$(helm status "$RELEASE" -n "$NAMESPACE" -o json)"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    if listed_releases="$(helm list --namespace "$NAMESPACE" --filter "^${RELEASE}$" --output json)"; then
      command_status=0
    else
      command_status=$?
    fi
    if (( command_status != 0 )); then
      err "Unable to determine whether a persisted database migration fence exists."
      return "$command_status"
    fi
    if ! jq -e 'type == "array" and length == 0' <<<"$listed_releases" >/dev/null; then
      err "OpenCrane Helm release exists but its persisted migration fence is unreadable."
      return 1
    fi
    return 0
  fi
  if release_values="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json)"; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    err "Unable to read a possible persisted database migration fence."
    return "$command_status"
  fi
  if ! active_fence="$(jq -er '.migrationFence.active // false' <<<"$release_values")"; then
    err "Unable to classify the persisted database migration fence."
    return 1
  fi
  if [[ "$active_fence" == "false" ]]; then
    return 0
  fi
  if ! DATABASE_FENCE_PRIOR_REPLICAS="$(jq -er --arg from "$FROM_RELEASE_VERSION" --arg to "$RELEASE_VERSION" '
    select(
      .migrationFence.active == true
      and .migrationFence.fromReleaseVersion == $from
      and .migrationFence.toReleaseVersion == $to
      and (.clustertenantManager.replicas // 0) == 0
    )
    | .migrationFence.previousReplicas
    | select(type == "number" and . > 0 and floor == .)
    | tostring
  ' <<<"$release_values")"; then
    err "Existing active migration fence does not exactly match this release transition."
    return 1
  fi
  log "Adopted the exact persisted migration fence for completed-transition finalization."
}

run_database_release_transition()
{
  local backup_evidence backup_status classification_status convergence_outcome policy_status
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "0" && "$DATABASE_TRANSITION_KIND" != "fresh" ]]; then
    if ! postgres_release_render_has_recovery; then
      err "A non-fresh database with no live Cluster must render spec.bootstrap.recovery from --postgres-values."
      return 1
    fi
  fi

  if [[ "$DATABASE_TRANSITION_KIND" != "migration" ]]; then
    if [[ "${DATABASE_PREVIOUS_MIGRATION_AVAILABLE:-false}" == "true" ]]; then
      if [[ "$POSTGRES_CLUSTER_EXISTS" == "0" ]]; then
        install_postgres_release false false || return $?
        POSTGRES_CLUSTER_EXISTS="1"
      fi
      classify_database_convergence_state || return $?
      case "$DATABASE_LIVE_CONVERGENCE_STATE" in
        current|completed) ;;
        *)
          err "Database evidence does not match the requested current release."
          return 1
          ;;
      esac
    else
      DATABASE_SELECTED_PROTECTED_BASELINE_SHA256="${POSTGRES_BASELINE_SHA256:-}"
    fi
    install_postgres_release false true
    return
  fi

  if [[ -z "${DATABASE_MIGRATION_SILO_ID:-}" || -z "${OIDC_ISSUER_URL:-}" ]]; then
    err "The 0.9.3 identity migration requires the exact ClusterTenant and OIDC issuer."
    return 2
  fi

  if [[ "$POSTGRES_CLUSTER_EXISTS" == "1" ]]; then
    if classify_database_convergence_state; then
      classification_status=0
    else
      classification_status=$?
    fi
    if (( classification_status != 0 )); then
      return "$classification_status"
    fi
    if convergence_outcome="$(resolve_database_convergence_outcome live_transition \
      "$DATABASE_LIVE_CONVERGENCE_STATE")"; then
      policy_status=0
    else
      policy_status=$?
    fi
    if (( policy_status != 0 )); then
      err "Database convergence policy rejected the live transition state."
      return "$policy_status"
    fi
    case "$convergence_outcome" in
      reconcile_without_fence)
        log "Database is already '$DATABASE_LIVE_CONVERGENCE_STATE'; skipping migration and server fencing."
        adopt_matching_existing_database_fence || return $?
        install_postgres_release false true
        return
        ;;
      reject_before_fence)
        err "Live database evidence is incompatible with this release transition; refusing to fence the server."
        return 1
        ;;
      migrate_source)
        :
        ;;
      *)
        err "Database convergence policy returned an unknown live-transition outcome."
        return 1
        ;;
    esac
  fi

  # Check the read-only backup prerequisite before fencing. The same script checks it again when it
  # creates recovery evidence, so losing the provider after this point still stops the migration.
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "1" && "${ALLOW_UNBACKED_DATABASE_MIGRATION:-0}" != "1" ]]; then
    if ! bash "$POSTGRES_MIGRATION_BACKUP" \
      "$NAMESPACE" "$POSTGRES_RELEASE" "$TIMEOUT" --preflight >/dev/null; then
      err "Database backup capability is not ready; refusing to fence the server."
      return 1
    fi
  fi
  capture_pre_fence_main_release_revision || return $?
  run_guarded_post_fence_stage fence_existing_opencrane_server || return $?
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "1" ]]; then
    # Applies pg_cron preload settings while the server is fenced, so the preflight proves the server can load the extension before its privileged migration creates it.
    run_guarded_post_fence_stage install_postgres_release false false || return $?
    run_guarded_post_fence_stage verify_database_pg_cron_server_preflight || return $?
    run_guarded_post_fence_stage publish_database_migration_config_map || return $?
  fi
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "0" ]]; then
    log "Restoring the previous-version database before its bounded migration…"
    run_guarded_post_fence_stage install_postgres_release false false || return $?
    POSTGRES_CLUSTER_EXISTS="1"
    run_guarded_post_fence_stage verify_database_pg_cron_server_preflight || return $?
    if classify_database_convergence_state; then
      classification_status=0
    else
      classification_status=$?
    fi
    if (( classification_status != 0 )); then
      recover_failed_database_transition "$classification_status"
      return $?
    fi
    if convergence_outcome="$(resolve_database_convergence_outcome recovered_transition \
      "$DATABASE_LIVE_CONVERGENCE_STATE")"; then
      policy_status=0
    else
      policy_status=$?
    fi
    if (( policy_status != 0 )); then
      err "Database convergence policy rejected the recovered transition state."
      return "$policy_status"
    fi
    case "$convergence_outcome" in
      reconcile_while_fenced)
        log "Recovered database is already '$DATABASE_LIVE_CONVERGENCE_STATE'; skipping migration."
        run_guarded_post_fence_stage install_postgres_release false true
        return
        ;;
      reject_keep_fence)
        err "Recovered database evidence is incompatible with this release transition; the server fence remains active."
        return 1
        ;;
      migrate_recovered_source)
        run_guarded_post_fence_stage publish_database_migration_config_map || return $?
        ;;
      *)
        err "Database convergence policy returned an unknown recovered-transition outcome."
        return 1
        ;;
    esac
  fi
  if [[ "${ALLOW_UNBACKED_DATABASE_MIGRATION:-0}" == "1" ]]; then
    log "WARNING: operator explicitly allowed this database migration without recovery-backup evidence."
  else
    if backup_evidence="$(bash "$POSTGRES_MIGRATION_BACKUP" \
      "$NAMESPACE" "$POSTGRES_RELEASE" "$TIMEOUT")"; then
      backup_status=0
    else
      backup_status=$?
    fi
    if (( backup_status != 0 )); then
      if recover_failed_database_transition "$backup_status"; then
        backup_status=0
      else
        backup_status=$?
      fi
      return "$backup_status"
    fi
    log "CNPG recovery evidence completed before migration: $backup_evidence"
  fi
  if [[ "${DATABASE_PRIVILEGED_EXTENSION:-}" == "pg_cron" ]]; then
    POSTGRES_SUPERUSER_ACCESS_ENABLED=true
    DATABASE_PRIVILEGED_EXTENSION_ENABLED=true
    DATABASE_TEMPORARY_SUPERUSER_ACCESS=true
    run_guarded_post_fence_stage install_postgres_release true false || return $?
    if ! revoke_temporary_database_superuser_access; then
      recover_failed_database_transition 1
      return 1
    fi
    run_guarded_post_fence_stage verify_database_pg_cron_preflight || return $?
    run_guarded_post_fence_stage install_postgres_release false true
    return
  fi
  run_guarded_post_fence_stage install_postgres_release true true
}
