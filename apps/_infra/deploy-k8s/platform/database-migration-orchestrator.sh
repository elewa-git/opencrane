#!/usr/bin/env bash
# Cohesive deploy-owned sequencing for the PostgreSQL release. The caller supplies resolved,
# manifest-bound globals plus log/err functions. This module may fence the application Helm release
# and reconcile the app-owned PostgreSQL chart; it never selects a migration or edits database bytes.

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
    --set-json "databases=$databases_json"
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME"
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET"
    --set-string "bootstrap.targetBaseline.sha256=$POSTGRES_BOOTSTRAP_BASELINE_SHA256"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY"
    --set-string "convergence.targetSchemaVersion=$DATABASE_TARGET_SCHEMA_VERSION"
    --set-string "convergence.targetBaselineSha256=$DATABASE_TARGET_BASELINE_SHA256"
    --set-string "convergence.currentProtectedBaselineSha256=$POSTGRES_BASELINE_SHA256"
    --set "convergence.previousMigration.available=$DATABASE_PREVIOUS_MIGRATION_AVAILABLE"
    --set-string "convergence.previousMigration.id=$DATABASE_PREVIOUS_MIGRATION_ID"
    --set-string "convergence.previousMigration.fromSchemaVersion=$DATABASE_PREVIOUS_SCHEMA_VERSION"
    --set-string "convergence.previousMigration.sourceProtectedBaselineSha256=$DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256"
    --set-string "convergence.previousMigration.sqlSha256=$DATABASE_PREVIOUS_MIGRATION_SQL_SHA256"
    --set "migration.enabled=$migration_enabled"
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
  local database_resource
  build_postgres_release_args "$migration_enabled" "$privileges_enabled"

  log "Reconciling PostgreSQL server while preserving bootstrap origin '$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP'…"
  helm "${POSTGRES_ARGS[@]}"
  kubectl wait --for=condition=Ready "cluster/${POSTGRES_RELEASE}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  kubectl wait --for=create "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  kubectl wait --for=condition=available "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  for database_resource in "${POSTGRES_RELEASE}-obot" "${POSTGRES_RELEASE}-litellm"; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  done
  if [[ "$migration_enabled" == "true" ]]; then
    kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-migration" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  fi
  if [[ "$privileges_enabled" == "true" ]]; then
    kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  fi
}

fence_existing_opencrane_server()
{
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
  server_deployment="${RELEASE}-opencrane-server"
  if ! helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    if ! server_deployment_inventory="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" --ignore-not-found -o name)"; then
      err "Unable to prove whether an orphan OpenCrane server deployment exists before database migration."
      exit 1
    fi
    if ! server_pod_inventory="$(kubectl get pods -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server pods exist before database migration."
      exit 1
    fi
    if ! server_replica_set_inventory="$(kubectl get replicasets -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server replica sets exist before database migration."
      exit 1
    fi
    if ! server_job_inventory="$(kubectl get jobs -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o name)"; then
      err "Unable to prove whether orphan OpenCrane server jobs exist before database migration."
      exit 1
    fi
    if [[ -n "$server_deployment_inventory" || -n "$server_pod_inventory" \
      || -n "$server_replica_set_inventory" || -n "$server_job_inventory" ]]; then
      err "OpenCrane server workload exists without its Helm release; database migration cannot prove a write fence."
      exit 1
    fi
    return
  fi
  prior_release_values="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json)"
  DATABASE_FENCE_PRIOR_REPLICAS="$(jq -r '.migrationFence.previousReplicas // .clustertenantManager.replicas // 1' <<<"$prior_release_values")"
  if [[ ! "$DATABASE_FENCE_PRIOR_REPLICAS" =~ ^[0-9]+$ || "$DATABASE_FENCE_PRIOR_REPLICAS" == "0" ]]; then
    err "Existing release '$RELEASE' has no recoverable positive server replica count for the database migration fence."
    exit 1
  fi
  log "Fencing the existing OpenCrane server through its Helm release before database mutation…"
  helm upgrade "$RELEASE" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --force-conflicts \
    --reuse-values \
    --set clustertenantManager.replicas=0 \
    --set migrationFence.active=true \
    --set migrationFence.previousReplicas="$DATABASE_FENCE_PRIOR_REPLICAS" \
    --set-string migrationFence.fromReleaseVersion="$FROM_RELEASE_VERSION" \
    --set-string migrationFence.toReleaseVersion="$RELEASE_VERSION" \
    --wait \
    --timeout "${TIMEOUT}s"
  if ! server_deployment_inventory="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" --ignore-not-found -o name)"; then
    err "Unable to read the fenced OpenCrane server deployment."
    exit 1
  fi
  if [[ -z "$server_deployment_inventory" ]]; then
    err "Helm release '$RELEASE' exists but its server deployment is absent after fencing."
    exit 1
  fi
  deployment_uid="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" -o jsonpath='{.metadata.uid}')"
  [[ -n "$deployment_uid" ]] || { err "Fenced OpenCrane server deployment has no readable UID."; exit 1; }
  fence_deadline="$(( $(date +%s) + TIMEOUT ))"
  while true; do
    desired_replicas="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
    live_replicas="$(kubectl get deployment "$server_deployment" -n "$NAMESPACE" -o jsonpath='{.status.replicas}' 2>/dev/null || true)"
    if ! server_pod_inventory="$(kubectl get pods -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o json)"; then
      err "Unable to inventory OpenCrane server pods after fencing."
      exit 1
    fi
    if ! server_replica_set_inventory="$(kubectl get replicasets -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o json)"; then
      err "Unable to inventory OpenCrane server replica sets after fencing."
      exit 1
    fi
    if ! server_job_inventory="$(kubectl get jobs -n "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-server" \
      -o json)"; then
      err "Unable to inventory OpenCrane server jobs after fencing."
      exit 1
    fi
    if ! jq -e --arg deployment_uid "$deployment_uid" '
      .items | all(
        (.spec.replicas // 0) == 0
        and any(.metadata.ownerReferences[]?; .kind == "Deployment" and .uid == $deployment_uid)
      )
    ' <<<"$server_replica_set_inventory" >/dev/null; then
      err "A server replica set is foreign-owned or remains scaled above zero after fencing."
      exit 1
    fi
    active_pod_count="$(jq '[.items[] | select(.status.phase == "Pending" or .status.phase == "Running" or .status.phase == "Unknown")] | length' <<<"$server_pod_inventory")"
    nonterminal_job_count="$(jq '[.items[] | select(all(.status.conditions[]?; .type != "Complete" and .type != "Failed"))] | length' <<<"$server_job_inventory")"
    if [[ "$desired_replicas" == "0" && "${live_replicas:-0}" == "0" \
      && "$active_pod_count" == "0" && "$nonterminal_job_count" == "0" ]]; then
      return
    fi
    if [[ "$(date +%s)" -ge "$fence_deadline" ]]; then
      err "OpenCrane server migration fence did not reach zero replicas; database mutation is blocked."
      exit 1
    fi
    sleep 2
  done
}

run_database_release_transition()
{
  local backup_evidence
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "0" && "$DATABASE_TRANSITION_KIND" != "fresh" ]]; then
    if ! postgres_release_render_has_recovery; then
      err "A non-fresh database with no live Cluster must render spec.bootstrap.recovery from --postgres-values."
      exit 1
    fi
  fi

  if [[ "$DATABASE_TRANSITION_KIND" != "migration" ]]; then
    install_postgres_release false true
    return
  fi

  fence_existing_opencrane_server
  if [[ "$POSTGRES_CLUSTER_EXISTS" == "0" ]]; then
    log "Restoring the previous-version database before its bounded migration…"
    install_postgres_release false false
    POSTGRES_CLUSTER_EXISTS="1"
  fi
  backup_evidence="$(bash "$POSTGRES_MIGRATION_BACKUP" "$NAMESPACE" "$POSTGRES_RELEASE" "$TIMEOUT")"
  log "CNPG recovery evidence completed before migration: $backup_evidence"
  install_postgres_release true true
}
