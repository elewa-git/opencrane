#!/usr/bin/env bash

# Proves that the live CNPG primary can host Absurd's pg_cron maintenance before its schema transition.

_database_pg_cron_preflight_error()
{
  printf 'database pg_cron preflight: %s\n' "$1" >&2
}

_database_pg_cron_preflight_inputs_are_valid()
{
  [[ -n "${NAMESPACE:-}" && -n "${POSTGRES_RELEASE:-}" ]] || return 1
  [[ "${TIMEOUT:-}" =~ ^[1-9][0-9]{0,3}$ ]] && (( TIMEOUT <= 3600 ))
}

_database_pg_cron_primary()
{
  local pod_inventory
  local primary_pod

  if ! pod_inventory="$(kubectl --request-timeout="${TIMEOUT}s" get pods \
    --namespace "$NAMESPACE" \
    --selector "cnpg.io/cluster=${POSTGRES_RELEASE},role=primary" \
    -o json)"; then
    _database_pg_cron_preflight_error "unable to inventory the CNPG primary for '$POSTGRES_RELEASE'"
    return 1
  fi
  if ! primary_pod="$(jq -er '
    if (.items | length) != 1 then error("primary cardinality") else .items[0] end
    | select(.metadata.deletionTimestamp == null)
    | select(.status.phase == "Running")
    | select(any(.status.conditions[]?; .type == "Ready" and .status == "True"))
    | .metadata.name
    | select(type == "string" and length > 0)
  ' <<<"$pod_inventory")"; then
    _database_pg_cron_preflight_error "expected exactly one Running and Ready CNPG primary for '$POSTGRES_RELEASE'"
    return 1
  fi
  printf '%s\n' "$primary_pod"
}

verify_database_pg_cron_server_preflight()
{
  local primary_pod
  local preflight_evidence
  local statement_timeout_ms

  if ! _database_pg_cron_preflight_inputs_are_valid; then
    _database_pg_cron_preflight_error "namespace, release, or timeout input is invalid"
    return 1
  fi
  if ! primary_pod="$(_database_pg_cron_primary)"; then
    return 1
  fi

  statement_timeout_ms="$((TIMEOUT * 1000))"
  if ! preflight_evidence="$(kubectl --request-timeout="${TIMEOUT}s" exec \
    --namespace "$NAMESPACE" \
    --container postgres \
    -i "$primary_pod" -- \
    psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --dbname opencrane \
      --set "statement_timeout_ms=$statement_timeout_ms" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = :'statement_timeout_ms';
SET LOCAL idle_in_transaction_session_timeout = :'statement_timeout_ms';

SELECT CASE
  WHEN current_database() = 'opencrane'
    AND EXISTS (
      SELECT 1
      FROM pg_available_extensions
      WHERE name = 'pg_cron'
    )
    AND EXISTS (
      SELECT 1
      FROM regexp_split_to_table(
        COALESCE(current_setting('shared_preload_libraries', true), ''),
        '\s*,\s*'
      ) AS preload_library(name)
      WHERE name = 'pg_cron'
    )
    AND current_setting('cron.database_name', true) = current_database()
  THEN 'ready'
  ELSE 'unavailable'
END;
COMMIT;
SQL
  )"; then
    _database_pg_cron_preflight_error "unable to read pg_cron evidence from '$primary_pod'"
    return 1
  fi
  if [[ "$preflight_evidence" != "ready" ]]; then
    _database_pg_cron_preflight_error "pg_cron is unavailable, not preloaded, or not bound to opencrane"
    return 1
  fi
  printf '%s\n' "$preflight_evidence"
}

verify_database_pg_cron_preflight()
{
  local extension_evidence
  local primary_pod
  local server_evidence

  if ! server_evidence="$(verify_database_pg_cron_server_preflight)"; then
    return 1
  fi
  if [[ "$server_evidence" != "ready" ]]; then
    _database_pg_cron_preflight_error "pg_cron server preflight returned invalid evidence"
    return 1
  fi
  if ! primary_pod="$(_database_pg_cron_primary)"; then
    return 1
  fi
  if ! extension_evidence="$(kubectl --request-timeout="${TIMEOUT}s" exec \
    --namespace "$NAMESPACE" \
    --container postgres \
    -i "$primary_pod" -- \
    psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname opencrane \
      --command "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN 'ready' ELSE 'unavailable' END")"; then
    _database_pg_cron_preflight_error "unable to read installed pg_cron extension evidence"
    return 1
  fi
  if [[ "$extension_evidence" != "ready" ]]; then
    _database_pg_cron_preflight_error "pg_cron extension is not installed"
    return 1
  fi
  printf '%s\n' "$extension_evidence"
}
