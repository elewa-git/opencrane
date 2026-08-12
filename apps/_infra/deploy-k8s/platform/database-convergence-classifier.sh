#!/usr/bin/env bash

# Classifies the live database's state, read-only. The deploy engine owns all manifest-derived inputs and
# decides what to do with the returned state; this module never selects a version or changes state.

_database_convergence_error()
{
  printf 'database convergence classifier: %s\n' "$1" >&2
}

_database_convergence_inputs_are_valid()
{
  local digest
  [[ -n "${NAMESPACE:-}" && -n "${POSTGRES_RELEASE:-}" ]] || return 1
  [[ "${TIMEOUT:-}" =~ ^[1-9][0-9]{0,3}$ ]] && (( TIMEOUT <= 3600 )) || return 1
  [[ "${DATABASE_PREVIOUS_MIGRATION_ID:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || return 1
  [[ "${DATABASE_PREVIOUS_SCHEMA_VERSION:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || return 1
  [[ "${DATABASE_TARGET_SCHEMA_VERSION:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || return 1
  for digest in \
    "${POSTGRES_BASELINE_SHA256:-}" \
    "${DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256:-}" \
    "${DATABASE_TARGET_BASELINE_SHA256:-}" \
    "${DATABASE_PREVIOUS_MIGRATION_SQL_SHA256:-}"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  done
  [[ "$POSTGRES_BASELINE_SHA256" != "$DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256" ]]
}

classify_live_database_convergence()
{
  local pod_inventory
  local primary_pod
  local convergence
  local statement_timeout_ms

  if ! _database_convergence_inputs_are_valid; then
    _database_convergence_error "manifest evidence, namespace, release, or timeout input is invalid"
    return 1
  fi
  if ! pod_inventory="$(kubectl --request-timeout="${TIMEOUT}s" get pods \
    --namespace "$NAMESPACE" \
    --selector "cnpg.io/cluster=${POSTGRES_RELEASE},role=primary" \
    -o json)"; then
    _database_convergence_error "unable to inventory the CNPG primary for '$POSTGRES_RELEASE'"
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
    _database_convergence_error "expected exactly one Running and Ready CNPG primary for '$POSTGRES_RELEASE'"
    return 1
  fi

  statement_timeout_ms="$((TIMEOUT * 1000))"
  if ! convergence="$(kubectl --request-timeout="${TIMEOUT}s" exec \
    --namespace "$NAMESPACE" \
    --container postgres \
    -i "$primary_pod" -- \
    psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --dbname opencrane \
      --set "statement_timeout_ms=$statement_timeout_ms" \
      --set "current_protected_baseline_sha256=$POSTGRES_BASELINE_SHA256" \
      --set "previous_protected_baseline_sha256=$DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256" \
      --set "previous_migration_id=$DATABASE_PREVIOUS_MIGRATION_ID" \
      --set "previous_schema_version=$DATABASE_PREVIOUS_SCHEMA_VERSION" \
      --set "target_schema_version=$DATABASE_TARGET_SCHEMA_VERSION" \
      --set "target_baseline_sha256=$DATABASE_TARGET_BASELINE_SHA256" \
      --set "previous_migration_sql_sha256=$DATABASE_PREVIOUS_MIGRATION_SQL_SHA256" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = :'statement_timeout_ms';
SET LOCAL idle_in_transaction_session_timeout = :'statement_timeout_ms';

SELECT count(*) AS origin_total,
       COALESCE(min("baseline_sha256"), '') AS recorded_origin
FROM "opencrane_bootstrap"."target_baseline"
WHERE "singleton" = TRUE
\gset

SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL AS history_exists
\gset
\if :history_exists
SELECT count(*) = 6 AS history_shape_matches
FROM information_schema.columns
WHERE table_schema = 'opencrane_migrations'
  AND table_name = 'schema_history'
  AND column_name IN (
    'schema_version', 'source_schema_version', 'source_baseline_sha256',
    'target_baseline_sha256', 'migration_id', 'sql_sha256'
  )
\gset
\if :history_shape_matches
SELECT count(*) AS history_total,
       count(*) FILTER (WHERE
         "schema_version" = :'target_schema_version'
         AND "source_schema_version" = :'previous_schema_version'
         AND "source_baseline_sha256" = :'previous_protected_baseline_sha256'
         AND "target_baseline_sha256" = :'target_baseline_sha256'
         AND "migration_id" = :'previous_migration_id'
         AND "sql_sha256" = :'previous_migration_sql_sha256') AS exact_history_total
FROM "opencrane_migrations"."schema_history"
\gset
\else
SELECT count(*) AS history_total, 0::bigint AS exact_history_total
FROM "opencrane_migrations"."schema_history"
\gset
\endif
\else
SELECT 0::bigint AS history_total, 0::bigint AS exact_history_total
\gset
\endif

SELECT CASE
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' = :'current_protected_baseline_sha256'
    AND NOT :'history_exists'::boolean
    THEN 'current'
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' = :'previous_protected_baseline_sha256'
    AND NOT :'history_exists'::boolean
    THEN 'source'
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' = :'previous_protected_baseline_sha256'
    AND :'history_exists'::boolean
    AND :'history_total'::bigint = 1
    AND :'exact_history_total'::bigint = 1
    THEN 'completed'
  ELSE 'incompatible'
END;
COMMIT;
SQL
  )"; then
    _database_convergence_error "unable to read bounded database evidence from '$primary_pod'"
    return 1
  fi

  case "$convergence" in
    current|completed|source|incompatible) printf '%s\n' "$convergence" ;;
    *)
      _database_convergence_error "psql returned malformed or ambiguous convergence evidence"
      return 1
      ;;
  esac
}
