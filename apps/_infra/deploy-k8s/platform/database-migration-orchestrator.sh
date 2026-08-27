#!/usr/bin/env bash
# Runs the reviewed PostgreSQL migration Job directly. The caller supplies migration inputs plus
# log/err functions; this module does not classify database state, pause application writes, or
# recover a failed migration.

build_postgres_release_args()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  local job_deadline_grace_seconds=30
  local helm_timeout_seconds="$((TIMEOUT + job_deadline_grace_seconds + 30))"
  local pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"agent-controller"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}}]'
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
    --set "superuserAccess.enabled=${POSTGRES_SUPERUSER_ACCESS_ENABLED:-false}"
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
      --set-string "migration.sqlSha256=$DATABASE_MIGRATION_SQL_SHA256"
      --set-string "migration.sourceBaselineSha256=$DATABASE_MIGRATION_SOURCE_BASELINE_SHA256"
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

wait_for_postgres_resource()
{
  local condition="$1"
  local resource="$2"
  local message="$3"
  if ! kubectl wait --for="$condition" "$resource" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    err "$message"
    return 1
  fi
}

install_postgres_release()
{
  local migration_enabled="$1"
  local privileges_enabled="$2"
  build_postgres_release_args "$migration_enabled" "$privileges_enabled"
  log "Reconciling PostgreSQL server…"
  helm "${POSTGRES_ARGS[@]}" || { err "PostgreSQL Helm reconciliation failed."; return 1; }
  wait_for_postgres_resource condition=Ready "cluster/${POSTGRES_RELEASE}" "PostgreSQL Cluster did not become Ready." || return $?
  wait_for_postgres_resource create "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment was not created." || return $?
  wait_for_postgres_resource condition=available "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment did not become Available." || return $?
  wait_for_postgres_resource "jsonpath={.status.applied}=true" "database/${POSTGRES_RELEASE}-litellm" "LiteLLM database was not applied." || return $?
  if [[ "$migration_enabled" == "true" ]]; then
    wait_for_postgres_resource condition=complete "job/${POSTGRES_RELEASE}-database-migration" "Database migration Job did not complete." || return $?
  fi
  if [[ "$privileges_enabled" == "true" ]]; then
    wait_for_postgres_resource condition=complete "job/${POSTGRES_RELEASE}-database-privileges" "Database privilege Job did not complete." || return $?
  fi
}

# Removes the temporary privileged credential after the pg_cron setup Job has completed.
revoke_temporary_database_superuser_access()
{
  if [[ "${DATABASE_TEMPORARY_SUPERUSER_ACCESS:-false}" != "true" ]]; then
    return 0
  fi
  POSTGRES_SUPERUSER_ACCESS_ENABLED=false
  DATABASE_PRIVILEGED_EXTENSION_ENABLED=false
  install_postgres_release false false || return $?
  verify_database_superuser_access_disabled || return $?
  DATABASE_TEMPORARY_SUPERUSER_ACCESS=false
}

publish_database_migration_config_map()
{
  local published_config_map
  if ! published_config_map="$(bash "$POSTGRES_MIGRATION_PUBLISHER" \
    "$NAMESPACE" "$DATABASE_MIGRATION_ID" "$DATABASE_MIGRATION_SQL_FILE" \
    "$DATABASE_MIGRATION_SQL_SHA256")"; then
    err "Unable to publish the reviewed database migration SQL."
    return 1
  fi
  if [[ -z "$published_config_map" ]]; then
    err "Database migration SQL publisher returned no immutable ConfigMap name."
    return 1
  fi
  DATABASE_MIGRATION_CONFIG_MAP="$published_config_map"
}

run_database_release_transition()
{
  if [[ "${DATABASE_MIGRATION_ENABLED:-false}" != "true" ]]; then
    install_postgres_release false true
    return
  fi
  if [[ -z "${DATABASE_MIGRATION_SILO_ID:-}" || -z "${OIDC_ISSUER_URL:-}" ]]; then
    err "The identity migration requires the ClusterTenant and OIDC issuer."
    return 2
  fi
  install_postgres_release false false || return $?
  verify_database_pg_cron_server_preflight || return $?
  publish_database_migration_config_map || return $?
  if [[ "${DATABASE_PRIVILEGED_EXTENSION:-}" == "pg_cron" ]]; then
    POSTGRES_SUPERUSER_ACCESS_ENABLED=true
    DATABASE_PRIVILEGED_EXTENSION_ENABLED=true
    DATABASE_TEMPORARY_SUPERUSER_ACCESS=true
    install_postgres_release true false || return $?
    revoke_temporary_database_superuser_access || return $?
    verify_database_pg_cron_preflight || return $?
    install_postgres_release false true
    return
  fi
  install_postgres_release true true
}
