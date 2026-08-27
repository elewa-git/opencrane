#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
MIGRATION_POLICY="$(mktemp)"
trap 'rm -f "$OUTPUT" "$MIGRATION_POLICY"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"}]'
POSTGRES_OPERAND_IMAGE='ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000'
BASE_VALUES=(--set-string "image=$POSTGRES_OPERAND_IMAGE" --set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.targetBaseline.sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql --set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 --set networkPolicy.kubernetesApiServerEndpointPort=6443)
MIGRATION_VALUES=(--set migration.enabled=true --set-string migration.sourceVersion=0.9.3 --set-string migration.image=ghcr.io/elewa-git/opencrane-prisma-migrator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)

helm lint "$CHART" "${BASE_VALUES[@]}" >/dev/null
helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" >"$OUTPUT"
grep -q '^kind: Cluster$' "$OUTPUT"
grep -q '^kind: Pooler$' "$OUTPUT"
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
if grep -q 'schema convergence\|CURRENT_SCHEMA_VERSION\|SELECTED_SOURCE_PROTECTED_BASELINE_SHA256' "$OUTPUT"; then
  echo "privilege job still performs a schema-state migration safeguard" >&2
  exit 1
fi

helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" "${MIGRATION_VALUES[@]}" --show-only templates/database-migration-job.yaml >"$OUTPUT"
grep -q 'name: opencrane-postgres-database-migration' "$OUTPUT"
grep -q 'image: "ghcr.io/elewa-git/opencrane-prisma-migrator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' "$OUTPUT"
grep -q 'name: DATABASE_URL' "$OUTPUT"
grep -q 'name: "opencrane-postgres-opencrane-app"' "$OUTPUT"
grep -q 'key: uri' "$OUTPUT"
grep -q 'name: OPENCRANE_MIGRATION_SOURCE_VERSION' "$OUTPUT"
grep -q 'value: "0.9.3"' "$OUTPUT"
if grep -q 'command:\|migration.sql\|EXPECTED_SQL_SHA256\|PGPASSWORD\|POSTGRES_SUPERUSER_PASSWORD' "$OUTPUT"; then
  echo "postgres chart still renders the retired direct-SQL migration path" >&2
  exit 1
fi

helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" "${MIGRATION_VALUES[@]}" --show-only templates/networkpolicy.yaml >"$OUTPUT"
sed -n '/name: opencrane-postgres-database-migration/,$p' "$OUTPUT" >"$MIGRATION_POLICY"
grep -q 'cnpg.io/poolerName: opencrane-postgres-pooler' "$MIGRATION_POLICY"
if grep -q 'cnpg.io/cluster:' "$MIGRATION_POLICY"; then
  echo "migration Job can still reach the database primary directly" >&2
  exit 1
fi

echo "postgres helm contract: PASS"
