#!/usr/bin/env bash
# Reconciles the PostgreSQL release. The schema is created once, by CNPG initdb from the
# app-owned target baseline; there is no version-to-version migration path pre-1.0 (see
# docs/agents/deploy-ledger.md, 2026-08-31). The caller supplies release inputs plus
# log/err functions.

build_postgres_release_args()
{
  local privileges_enabled="$1"
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
    --set "privileges.enabled=$privileges_enabled"
    --set-json "pooler.clientPodSelectors=$pooler_client_selectors_json"
    --wait
    --timeout "${helm_timeout_seconds}s"
    "${POSTGRES_KUBERNETES_API_ARGS[@]}")
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
  local privileges_enabled="$1"
  build_postgres_release_args "$privileges_enabled"
  log "Reconciling PostgreSQL server…"
  helm "${POSTGRES_ARGS[@]}" || { err "PostgreSQL Helm reconciliation failed."; return 1; }
  wait_for_postgres_resource condition=Ready "cluster/${POSTGRES_RELEASE}" "PostgreSQL Cluster did not become Ready." || return $?
  wait_for_postgres_resource create "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment was not created." || return $?
  wait_for_postgres_resource condition=available "deployment/${POSTGRES_RELEASE}-pooler" "PostgreSQL pooler Deployment did not become Available." || return $?
  wait_for_postgres_resource "jsonpath={.status.applied}=true" "database/${POSTGRES_RELEASE}-litellm" "LiteLLM database was not applied." || return $?
  if [[ "$privileges_enabled" == "true" ]]; then
    wait_for_postgres_resource condition=complete "job/${POSTGRES_RELEASE}-database-privileges" "Database privilege Job did not complete." || return $?
  fi
}
