#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"obot","owner":"obot","credentialsSecret":"postgres-obot-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"},{"name":"langfuse","owner":"langfuse","credentialsSecret":"postgres-langfuse-bootstrap"}]'
COMMON_VALUES=(--set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline-deadbeef --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql)

helm lint "$CHART" "${COMMON_VALUES[@]}" >/dev/null
bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/pooler-deploy-contract.sh"
helm template opencrane-postgres "$CHART" \
  --namespace opencrane \
  "${COMMON_VALUES[@]}" \
  --set storage.storageClass=expandable-rwo \
  --set backup.enabled=true \
  --set backup.plugin.name=barman-cloud.cloudnative-pg.io \
  --set backup.plugin.parameters.barmanObjectName=opencrane-postgres \
  >"$OUTPUT"

grep -q '^kind: Cluster$' "$OUTPUT"
test "$(grep -c '^kind: Cluster$' "$OUTPUT")" -eq 1
grep -q '^kind: Pooler$' "$OUTPUT"
test "$(grep -c '^kind: Pooler$' "$OUTPUT")" -eq 1
grep -q 'name: opencrane-postgres-pooler' "$OUTPUT"
grep -q 'poolMode: "session"' "$OUTPUT"
grep -q 'max_client_conn: "50"' "$OUTPUT"
grep -q 'max_db_connections: "10"' "$OUTPUT"
grep -q 'max_connections: "80"' "$OUTPUT"
test "$(grep -c '^kind: Database$' "$OUTPUT")" -eq 3
test "$(grep -c 'helm.sh/resource-policy: keep' "$OUTPUT")" -eq 4
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'helm.sh/hook: post-install,post-upgrade' "$OUTPUT"
test "$(grep -c 'app.kubernetes.io/component: postgres-database-privileges' "$OUTPUT")" -ge 2
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'GRANT CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'name: "postgres-admin-bootstrap"' "$OUTPUT"
grep -q 'name: "opencrane_database_admin"' "$OUTPUT"
grep -q 'pg_read_all_data' "$OUTPUT"
grep -q 'pg_monitor' "$OUTPUT"
grep -q 'TO :"database_admin"' "$OUTPUT"
grep -q '^kind: ScheduledBackup$' "$OUTPUT"
grep -q '^kind: NetworkPolicy$' "$OUTPUT"
grep -q 'helm.sh/resource-policy: keep' "$OUTPUT"
grep -q 'opencrane.ai/cnpg-service-account: "opencrane-postgres"' "$OUTPUT"
grep -q 'size: "20Gi"' "$OUTPUT"
grep -q 'resizeInUseVolumes: true' "$OUTPUT"
grep -q -- '- ReadWriteOnce' "$OUTPUT"
grep -q 'storageClass: "expandable-rwo"' "$OUTPUT"
grep -q 'name: "postgres-opencrane-bootstrap"' "$OUTPUT"
grep -q 'name: "postgres-obot-bootstrap"' "$OUTPUT"
grep -q 'name: "postgres-litellm-bootstrap"' "$OUTPUT"
grep -q 'name: "postgres-langfuse-bootstrap"' "$OUTPUT"
grep -q 'opencrane.ai/database-baseline-config-map: "opencrane-database-baseline-deadbeef"' "$OUTPUT"
grep -q 'postInitApplicationSQLRefs:' "$OUTPUT"
grep -q 'key: target-baseline.sql' "$OUTPUT"
grep -q 'name: "obot"' "$OUTPUT"
grep -q 'name: "litellm"' "$OUTPUT"
grep -q 'name: "langfuse"' "$OUTPUT"
grep -q 'createdb: false' "$OUTPUT"
grep -q 'createrole: false' "$OUTPUT"
grep -q 'method: plugin' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server' "$OUTPUT"
grep -q 'app.kubernetes.io/component: mcp-gateway' "$OUTPUT"
grep -q 'app.kubernetes.io/component: litellm' "$OUTPUT"
grep -q 'app.kubernetes.io/name: langfuse' "$OUTPUT"
grep -q 'app.kubernetes.io/component: fleet-manager' "$OUTPUT"

if grep -qE '^kind: (ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$OUTPUT"; then
  echo "postgres chart must not duplicate the deterministic CloudNativePG runtime identity" >&2
  exit 1
fi

if helm template invalid "$CHART" >/dev/null 2>&1; then
  echo "postgres chart accepted missing database credentials" >&2
  exit 1
fi

function _assert_invalid_databases()
{
  local label="$1"
  local databases_json="$2"
  if helm template "$label" "$CHART" --set-json "databases=$databases_json" >/dev/null 2>&1; then
    echo "postgres chart accepted $label database configuration" >&2
    exit 1
  fi
}

_assert_invalid_databases duplicate-name '[{"name":"opencrane","owner":"opencrane","credentialsSecret":"opencrane-secret"},{"name":"opencrane","owner":"obot","credentialsSecret":"obot-secret"}]'
_assert_invalid_databases duplicate-owner '[{"name":"opencrane","owner":"opencrane","credentialsSecret":"opencrane-secret"},{"name":"obot","owner":"opencrane","credentialsSecret":"obot-secret"}]'
_assert_invalid_databases duplicate-credentials '[{"name":"opencrane","owner":"opencrane","credentialsSecret":"shared-secret"},{"name":"obot","owner":"obot","credentialsSecret":"shared-secret"}]'

if helm template invalid-pool-budget "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set postgresql.maxConnections=20 \
  --set pooler.maxDbConnections=10 >/dev/null 2>&1; then
  echo "postgres chart accepted a pooler server-connection budget above PostgreSQL capacity" >&2
  exit 1
fi

helm template one-database "$CHART" \
  --set-json 'databases=[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"}]' \
  --set-string databaseAdmin.name=opencrane_database_admin \
  --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline-deadbeef \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql \
  >"$OUTPUT"
grep -q 'name: "opencrane_database_admin"' "$OUTPUT"
grep -q 'pg_read_all_data' "$OUTPUT"

helm template restored "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set restore.enabled=true \
  --set-string restore.sourceBaselineConfigMap=opencrane-database-baseline-deadbeef \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
  --set restore.plugin.parameters.barmanObjectName=opencrane-postgres \
  --set-string restore.targetTime=2026-07-18T00:00:00Z \
  >"$OUTPUT"
grep -q 'source: "source"' "$OUTPUT"
grep -q 'targetTime: "2026-07-18T00:00:00Z"' "$OUTPUT"
grep -q 'barmanObjectName: opencrane-postgres' "$OUTPUT"
grep -q 'opencrane.ai/database-baseline-config-map: "opencrane-database-baseline-deadbeef"' "$OUTPUT"
if grep -q 'postInitApplicationSQLRefs:' "$OUTPUT"; then
  echo "postgres recovery must not attach the fresh-database baseline" >&2
  exit 1
fi

if helm template missing-baseline "$CHART" \
  --set-json "databases=$DATABASES_JSON" \
  --set-string databaseAdmin.name=opencrane_database_admin \
  --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap >/dev/null 2>&1; then
  echo "postgres chart accepted a fresh database without its target baseline" >&2
  exit 1
fi

if helm template restored-without-provenance "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set restore.enabled=true \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io >/dev/null 2>&1; then
  echo "postgres chart accepted recovery without source baseline provenance" >&2
  exit 1
fi

deploy_script="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
grep -q 'reconciled_baseline=.*opencrane\\.ai/database-baseline-config-map' "$deploy_script"
grep -q 'if \[\[ "$reconciled_baseline" != "$POSTGRES_BASELINE_CONFIG_MAP" \]\]' "$deploy_script"
grep -q 'Restore a compatible physical backup or recreate the database' "$deploy_script"

echo "postgres Helm contract: PASS"
