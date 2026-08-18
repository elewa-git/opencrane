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
    "${DATABASE_PREVIOUS_TARGET_BASELINE_SHA256:-}" \
    "${DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256:-}" \
    "${DATABASE_TARGET_BASELINE_SHA256:-}" \
    "${DATABASE_PREVIOUS_MIGRATION_SQL_SHA256:-}"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  done
  [[ "$POSTGRES_BASELINE_SHA256" != "$DATABASE_PREVIOUS_TARGET_BASELINE_SHA256" ]] || return 1
  jq -e --arg fresh_origin "$DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256" '
    type == "array"
    and length > 0
    and all(.[]; type == "string" and test("^[0-9a-f]{64}$"))
    and length == (unique | length)
    and index($fresh_origin) != null
  ' <<<"${DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON:-}" >/dev/null || return 1
  jq -e --argjson origins "$DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON" '
    type == "array"
    and length == ($origins | length)
    and map(.sourceProtectedBaselineSha256) == $origins
    and all(.[];
      (.history | type == "array")
      and all(.history[];
        (.schemaVersion | type == "string")
        and (.sourceSchemaVersion | type == "string")
        and (.sourceProtectedBaselineSha256 | test("^[0-9a-f]{64}$"))
        and (.targetBaselineSha256 | test("^[0-9a-f]{64}$"))
        and (.migrationId | type == "string")
        and (.sqlSha256 | test("^[0-9a-f]{64}$"))
      )
    )
  ' <<<"${DATABASE_SOURCE_HISTORY_LINEAGES_JSON:-}" >/dev/null || return 1
}

classify_live_database_convergence()
{
  local pod_inventory
  local primary_pod
  local convergence_evidence
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
  if ! convergence_evidence="$(kubectl --request-timeout="${TIMEOUT}s" exec \
    --namespace "$NAMESPACE" \
    --container postgres \
    -i "$primary_pod" -- \
    psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --dbname opencrane \
      --set "statement_timeout_ms=$statement_timeout_ms" \
      --set "current_protected_baseline_sha256=$POSTGRES_BASELINE_SHA256" \
      --set "previous_target_baseline_sha256=$DATABASE_PREVIOUS_TARGET_BASELINE_SHA256" \
      --set "previous_fresh_protected_baseline_sha256=$DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256" \
      --set "admitted_source_protected_baseline_sha256s_json=$DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON" \
      --set "source_history_lineages_json=$DATABASE_SOURCE_HISTORY_LINEAGES_JSON" \
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
SELECT count(*) = 7 AS history_shape_matches
FROM information_schema.columns
WHERE table_schema = 'opencrane_migrations'
  AND table_name = 'schema_history'
  AND column_name IN (
    'schema_version', 'source_schema_version', 'source_baseline_sha256',
    'target_baseline_sha256', 'migration_id', 'sql_sha256', 'applied_at'
  )
\gset
\if :history_shape_matches
-- Rebuild one uninterrupted chain from the expected source and target. Extra, duplicate, cyclic,
-- or unlinked rows make the database incompatible instead of extending deployment authority.
WITH RECURSIVE history AS MATERIALIZED (
  SELECT "schema_version", "source_schema_version", "source_baseline_sha256",
         "target_baseline_sha256", "migration_id", "sql_sha256", "applied_at"
  FROM "opencrane_migrations"."schema_history"
), source_chain AS (
  SELECT history.*, ARRAY["schema_version"]::text[] AS visited_versions
  FROM history
  WHERE "schema_version" = :'previous_schema_version'
  UNION ALL
  SELECT predecessor.*, chain.visited_versions || predecessor."schema_version"
  FROM source_chain AS chain
  JOIN history AS predecessor
    ON predecessor."schema_version" = chain."source_schema_version"
  WHERE NOT predecessor."schema_version" = ANY(chain.visited_versions)
), completed_chain AS (
  SELECT history.*, ARRAY["schema_version"]::text[] AS visited_versions
  FROM history
  WHERE "schema_version" = :'target_schema_version'
  UNION ALL
  SELECT predecessor.*, chain.visited_versions || predecessor."schema_version"
  FROM completed_chain AS chain
  JOIN history AS predecessor
    ON predecessor."schema_version" = chain."source_schema_version"
  WHERE NOT predecessor."schema_version" = ANY(chain.visited_versions)
)
SELECT
  (SELECT count(*) FROM history) AS history_total,
  (SELECT count(*) FROM history
   WHERE "schema_version" = :'target_schema_version'
     AND "source_schema_version" = :'previous_schema_version'
     AND "source_baseline_sha256" = :'recorded_origin'
     AND "target_baseline_sha256" = :'target_baseline_sha256'
     AND "migration_id" = :'previous_migration_id'
     AND "sql_sha256" = :'previous_migration_sql_sha256') AS exact_history_total,
  (
    (SELECT count(*) FROM history) > 0
    AND (SELECT count(*) FROM source_chain) = (SELECT count(*) FROM history)
    AND (SELECT count(*) = count(DISTINCT "schema_version") FROM source_chain)
    AND (SELECT count(*) = count(DISTINCT "migration_id") FROM source_chain)
    AND NOT EXISTS (
      SELECT 1 FROM source_chain
      WHERE "source_baseline_sha256" <> :'recorded_origin'
        OR "source_baseline_sha256" !~ '^[0-9a-f]{64}$'
        OR "target_baseline_sha256" !~ '^[0-9a-f]{64}$'
        OR "sql_sha256" !~ '^[0-9a-f]{64}$'
        OR "applied_at" IS NULL
    )
    AND (SELECT count(*) FROM source_chain
      WHERE "schema_version" = :'previous_schema_version'
        AND "target_baseline_sha256" = :'previous_target_baseline_sha256') = 1
    AND (SELECT count(*) FROM source_chain AS child
      WHERE NOT EXISTS (
        SELECT 1 FROM source_chain AS predecessor
        WHERE predecessor."schema_version" = child."source_schema_version"
      )) = 1
    AND NOT EXISTS (
      SELECT 1 FROM source_chain AS child
      JOIN source_chain AS predecessor
        ON predecessor."schema_version" = child."source_schema_version"
      WHERE predecessor."applied_at" > child."applied_at"
    )
  ) AS source_history_matches,
  (
    (SELECT count(*) FROM history) > 0
    AND (SELECT count(*) FROM completed_chain) = (SELECT count(*) FROM history)
    AND (SELECT count(*) = count(DISTINCT "schema_version") FROM completed_chain)
    AND (SELECT count(*) = count(DISTINCT "migration_id") FROM completed_chain)
    AND NOT EXISTS (
      SELECT 1 FROM completed_chain
      WHERE "source_baseline_sha256" <> :'recorded_origin'
        OR "source_baseline_sha256" !~ '^[0-9a-f]{64}$'
        OR "target_baseline_sha256" !~ '^[0-9a-f]{64}$'
        OR "sql_sha256" !~ '^[0-9a-f]{64}$'
        OR "applied_at" IS NULL
    )
    AND (SELECT count(*) FROM completed_chain AS child
      WHERE NOT EXISTS (
        SELECT 1 FROM completed_chain AS predecessor
        WHERE predecessor."schema_version" = child."source_schema_version"
      )) = 1
    AND NOT EXISTS (
      SELECT 1 FROM completed_chain AS child
      JOIN completed_chain AS predecessor
        ON predecessor."schema_version" = child."source_schema_version"
      WHERE predecessor."applied_at" > child."applied_at"
    )
    AND (
      ((SELECT count(*) FROM history) = 1
        AND :'recorded_origin' = :'previous_fresh_protected_baseline_sha256')
      OR EXISTS (
        SELECT 1 FROM completed_chain
        WHERE "schema_version" = :'previous_schema_version'
          AND "target_baseline_sha256" = :'previous_target_baseline_sha256'
      )
    )
  ) AS completed_history_matches,
  -- Match every earlier row against the release-ledger lineage for the live protected origin. A
  -- structurally valid history from an origin that the release did not admit cannot authorize migration.
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(:'source_history_lineages_json'::jsonb) AS lineage(value)
    WHERE lineage.value->>'sourceProtectedBaselineSha256' = :'recorded_origin'
      AND jsonb_array_length(lineage.value->'history') = (
        SELECT count(*) FROM history
        WHERE "schema_version" <> :'target_schema_version'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(lineage.value->'history') AS expected(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM history AS live
          WHERE live."schema_version" <> :'target_schema_version'
            AND live."schema_version" = expected.value->>'schemaVersion'
            AND live."source_schema_version" = expected.value->>'sourceSchemaVersion'
            AND live."source_baseline_sha256" = expected.value->>'sourceProtectedBaselineSha256'
            AND live."target_baseline_sha256" = expected.value->>'targetBaselineSha256'
            AND live."migration_id" = expected.value->>'migrationId'
            AND live."sql_sha256" = expected.value->>'sqlSha256'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM history AS live
        WHERE live."schema_version" <> :'target_schema_version'
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(lineage.value->'history') AS expected(value)
            WHERE live."schema_version" = expected.value->>'schemaVersion'
              AND live."source_schema_version" = expected.value->>'sourceSchemaVersion'
              AND live."source_baseline_sha256" = expected.value->>'sourceProtectedBaselineSha256'
              AND live."target_baseline_sha256" = expected.value->>'targetBaselineSha256'
              AND live."migration_id" = expected.value->>'migrationId'
              AND live."sql_sha256" = expected.value->>'sqlSha256'
          )
      )
  ) AS admitted_source_history_matches
\gset
\else
SELECT count(*) AS history_total, 0::bigint AS exact_history_total,
       FALSE AS source_history_matches, FALSE AS completed_history_matches,
       FALSE AS admitted_source_history_matches
FROM "opencrane_migrations"."schema_history"
\gset
\endif
\else
SELECT 0::bigint AS history_total, 0::bigint AS exact_history_total,
       FALSE AS source_history_matches, FALSE AS completed_history_matches,
       FALSE AS admitted_source_history_matches
\gset
\endif

SELECT (CASE
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' = :'current_protected_baseline_sha256'
    AND NOT :'history_exists'::boolean
    THEN 'current'
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' = :'previous_fresh_protected_baseline_sha256'
    AND :'admitted_source_protected_baseline_sha256s_json'::jsonb ? :'recorded_origin'
    AND NOT :'history_exists'::boolean
    THEN 'source'
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' <> :'current_protected_baseline_sha256'
    AND :'admitted_source_protected_baseline_sha256s_json'::jsonb ? :'recorded_origin'
    AND :'history_exists'::boolean
    AND :'source_history_matches'::boolean
    AND :'admitted_source_history_matches'::boolean
    THEN 'source'
  WHEN :'origin_total'::bigint = 1
    AND :'recorded_origin' <> :'current_protected_baseline_sha256'
    AND :'admitted_source_protected_baseline_sha256s_json'::jsonb ? :'recorded_origin'
    AND :'history_exists'::boolean
    AND :'completed_history_matches'::boolean
    AND :'admitted_source_history_matches'::boolean
    AND :'exact_history_total'::bigint = 1
    THEN 'completed'
  ELSE 'incompatible'
END) || '|' || :'recorded_origin';
COMMIT;
SQL
  )"; then
    _database_convergence_error "unable to read bounded database evidence from '$primary_pod'"
    return 1
  fi

  if [[ ! "$convergence_evidence" =~ ^(current|completed|source)\|([0-9a-f]{64})$ \
    && ! "$convergence_evidence" =~ ^incompatible\|([0-9a-f]{64})?$ ]]; then
    _database_convergence_error "psql returned malformed or ambiguous convergence evidence"
    return 1
  fi
  printf '%s\n' "$convergence_evidence"
}
