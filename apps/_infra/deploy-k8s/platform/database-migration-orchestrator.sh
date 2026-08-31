#!/usr/bin/env bash
# Runs the dedicated Prisma migration Job. The caller supplies the immutable image and publishes
# the pooled application connection before this module enables the Job.

build_postgres_release_args()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  local pg_cron_schema_owner_enabled="$3"
  local job_deadline_grace_seconds=30
  local helm_timeout_seconds="$((TIMEOUT + job_deadline_grace_seconds + 30))"
  local pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"agent-controller"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/component":"postgres-database-migration"}}]'
  local databases_json="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"}]"
  POSTGRES_ARGS=(upgrade --install "$POSTGRES_RELEASE" "$POSTGRES_CHART_DIR"
    --namespace "$NAMESPACE"
    --set-string "image=$POSTGRES_OPERAND_IMAGE"
    --set-json "databases=$databases_json"
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME"
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET"
    --set-string "bootstrap.targetBaseline.sha256=$POSTGRES_BOOTSTRAP_BASELINE_SHA256"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=$POSTGRES_BOOTSTRAP_BASELINE_CONFIG_MAP_KEY"
    --set "migration.enabled=$migration_enabled"
    --set "privileges.enabled=$privileges_enabled"
    --set "pgCron.assignSchemaOwnership=$pg_cron_schema_owner_enabled"
    --set-json "pooler.clientPodSelectors=$pooler_client_selectors_json"
    --wait
    --timeout "${helm_timeout_seconds}s"
    "${POSTGRES_KUBERNETES_API_ARGS[@]}")
  if [[ "$migration_enabled" == "true" ]]; then
    POSTGRES_ARGS+=(
      --set "migration.timeoutSeconds=$TIMEOUT"
      --set "migration.jobDeadlineGraceSeconds=$job_deadline_grace_seconds"
      --set-string "migration.image=$PRISMA_MIGRATOR_IMAGE"
      --set-string "migration.sourceVersion=$FROM_RELEASE_VERSION"
      --set-string "migration.siloId=$CLUSTER_TENANT"
      --set-string "migration.oidcIssuer=$OIDC_ISSUER_URL")
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

wait_for_postgres_resource()
{
  local condition="$1"
  local resource="$2"
  local message="$3"

  # The pinned kubectl 1.30 client cannot wait for creation, so poll for resource presence within
  # the same deployment timeout instead of depending on a newer client-only condition.
  if [[ "$condition" == "create" ]]; then
    local deadline="$((SECONDS + TIMEOUT))"
    local expected_name="${resource#*/}"
    local query_result
    local remaining_seconds

    while (( SECONDS < deadline )); do
      remaining_seconds="$((deadline - SECONDS))"
      if ! query_result="$(kubectl get "$resource" -n "$NAMESPACE" --ignore-not-found \
        -o 'jsonpath={.metadata.name}' --request-timeout="${remaining_seconds}s" 2>&1)"; then
        err "$message kubectl get failed: ${query_result:-no error details were returned}"
        return 1
      fi

      # Kubectl may emit a successful warning before JSONPath output, so accept the name on the final line.
      if [[ "$query_result" == "$expected_name" || "$query_result" == *$'\n'"$expected_name" ]]; then
        return 0
      fi

      if (( SECONDS >= deadline )); then
        break
      fi
      sleep 1
    done

    err "$message"
    return 1
  fi

  if ! kubectl wait --for="$condition" "$resource" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    err "$message"
    return 1
  fi
}

wait_for_postgres_database_applied()
{
  local resource="$1"
  local message="$2"
  local deadline="$(( $(date +%s) + TIMEOUT ))"
  local state
  local generation
  local observed_generation
  local applied
  while true; do
    state="$(kubectl get "$resource" -n "$NAMESPACE" -o jsonpath='{.metadata.generation}{" "}{.status.observedGeneration}{" "}{.status.applied}' 2>/dev/null || true)"
    read -r generation observed_generation applied <<<"$state"
    if [[ -n "$generation" && "$generation" == "$observed_generation" && "$applied" == "true" ]]; then
      return
    fi
    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      kubectl get "$resource" -n "$NAMESPACE" -o yaml >&2 || true
      err "$message"
      return 1
    fi
    sleep 2
  done
}

install_postgres_release()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  local pg_cron_schema_owner_enabled="$3"
  build_postgres_release_args "$migration_enabled" "$privileges_enabled" "$pg_cron_schema_owner_enabled"
  log "Reconciling PostgreSQL server…"
  helm "${POSTGRES_ARGS[@]}" || { err "PostgreSQL Helm reconciliation failed."; return 1; }
  wait_for_postgres_resource condition=Ready "cluster/${POSTGRES_RELEASE}" "PostgreSQL Cluster did not become Ready." || return $?
  wait_for_postgres_resource create "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment was not created." || return $?
  wait_for_postgres_resource condition=available "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment did not become Available." || return $?
  wait_for_postgres_database_applied "database/${POSTGRES_RELEASE}-opencrane" "OpenCrane database objects were not applied." || return $?
  wait_for_postgres_database_applied "database/${POSTGRES_RELEASE}-litellm" "LiteLLM database was not applied." || return $?
  if [[ "$migration_enabled" == "true" ]]; then
    wait_for_postgres_resource condition=complete "job/${POSTGRES_RELEASE}-database-migration" "Database migration Job did not complete." || return $?
  fi
  if [[ "$privileges_enabled" == "true" ]]; then
    wait_for_postgres_resource condition=complete "job/${POSTGRES_RELEASE}-database-privileges" "Database privilege Job did not complete." || return $?
  fi
}

# Installs PostgreSQL without the migration Job so the caller can publish its pooler connection Secret.
prepare_database_release_transition()
{
  if [[ "${DATABASE_MIGRATION_ENABLED:-false}" != "true" ]]; then
    install_postgres_release false true true
    return
  fi
  install_postgres_release false false false || return $?
  install_postgres_release false false true || return $?
}

# Enables the migration Job after the caller has published its pooler connection Secret.
finish_database_release_transition()
{
  if [[ "${DATABASE_MIGRATION_ENABLED:-false}" != "true" ]]; then
    return
  fi
  install_postgres_release true true true
}
