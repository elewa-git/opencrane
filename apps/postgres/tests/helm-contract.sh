#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"obot","owner":"obot","credentialsSecret":"postgres-obot-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"},{"name":"langfuse","owner":"langfuse","credentialsSecret":"postgres-langfuse-bootstrap"}]'
BASE_VALUES=(--set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.targetBaseline.sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline-deadbeef --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql)
API_VALUES=(--set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 --set networkPolicy.kubernetesApiServerEndpointPort=6443)
COMMON_VALUES=("${BASE_VALUES[@]}" "${API_VALUES[@]}")

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

INSTANCE_POLICY="$(awk 'BEGIN { RS="---" } /kind: NetworkPolicy/ && /name: opencrane-postgres-ingress/ { print }' "$OUTPUT")"
POOLER_POLICY="$(awk 'BEGIN { RS="---" } /kind: NetworkPolicy/ && /name: opencrane-postgres-pooler-boundary/ { print }' "$OUTPUT")"
[[ -n "$INSTANCE_POLICY" ]]
[[ -n "$POOLER_POLICY" ]]
grep -q 'app.kubernetes.io/component: postgres-database-privileges' <<<"$INSTANCE_POLICY"
grep -q 'cnpg.io/poolerName: opencrane-postgres-pooler' <<<"$INSTANCE_POLICY"
grep -q 'app.kubernetes.io/component: opencrane-server' <<<"$POOLER_POLICY"
grep -q 'app.kubernetes.io/component: mcp-gateway' <<<"$POOLER_POLICY"
grep -q 'app.kubernetes.io/component: litellm' <<<"$POOLER_POLICY"
grep -q 'app.kubernetes.io/name: langfuse' <<<"$POOLER_POLICY"
grep -q 'cnpg.io/poolerName: opencrane-postgres-pooler' <<<"$POOLER_POLICY"
grep -q 'cnpg.io/cluster: opencrane-postgres' <<<"$POOLER_POLICY"
grep -q '    - Egress' <<<"$POOLER_POLICY"
grep -q '          port: 5432' <<<"$POOLER_POLICY"
grep -q '          port: 53' <<<"$POOLER_POLICY"
grep -q '            cidr: "10.43.0.1/32"' <<<"$POOLER_POLICY"
grep -q '            cidr: "172.18.0.2/32"' <<<"$POOLER_POLICY"
grep -q '          port: 443' <<<"$POOLER_POLICY"
grep -q '          port: 6443' <<<"$POOLER_POLICY"
if grep -q 'namespaceSelector' <<<"$POOLER_POLICY"; then
  echo "postgres pooler boundary must not admit cross-namespace clients or destinations" >&2
  exit 1
fi
if grep -Eq 'app.kubernetes.io/(component: (opencrane-server|mcp-gateway|litellm|fleet-manager)|name: langfuse)' <<<"$INSTANCE_POLICY"; then
  echo "postgres instance policy allows an application to bypass the pooler" >&2
  exit 1
fi
if grep -q 'app.kubernetes.io/component: postgres-database-privileges' <<<"$POOLER_POLICY"; then
  echo "postgres privileges hook is unnecessarily admitted through the pooler" >&2
  exit 1
fi

grep -q '^kind: Cluster$' "$OUTPUT"
test "$(grep -c '^kind: Cluster$' "$OUTPUT")" -eq 1
grep -q '^kind: Pooler$' "$OUTPUT"
test "$(grep -c '^kind: Pooler$' "$OUTPUT")" -eq 1
grep -q 'name: opencrane-postgres-pooler' "$OUTPUT"
grep -q 'image: "ghcr.io/cloudnative-pg/pgbouncer:1.25.1"' "$OUTPUT"
grep -q 'poolMode: "session"' "$OUTPUT"
grep -q 'max_client_conn: "50"' "$OUTPUT"
grep -q 'max_db_connections: "10"' "$OUTPUT"
grep -q 'max_connections: "80"' "$OUTPUT"
test "$(grep -c '^kind: Database$' "$OUTPUT")" -eq 3
test "$(grep -c 'helm.sh/resource-policy: keep' "$OUTPUT")" -eq 4
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'helm.sh/hook: post-install,post-upgrade' "$OUTPUT"
grep -q 'activeDeadlineSeconds: 330' "$OUTPUT"
test "$(grep -c 'app.kubernetes.io/component: postgres-database-privileges' "$OUTPUT")" -ge 2
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'GRANT CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q -- '--single-transaction' "$OUTPUT"
test "$(grep -c 'until psql' "$OUTPUT")" -eq 4
grep -q 'until recorded_baseline=' "$OUTPUT"
grep -q "Timed out reading the target baseline from logical database" "$OUTPUT"
grep -q "Timed out applying privileges for logical database" "$OUTPUT"
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
grep -q 'name: EXPECTED_BASELINE_SHA256' "$OUTPUT"
grep -q 'value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' "$OUTPUT"
grep -q 'SELECT "baseline_sha256" FROM "opencrane_bootstrap"."target_baseline"' "$OUTPUT"
grep -q 'records baseline.*but.*is required' "$OUTPUT"

if grep -qE '^kind: (ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$OUTPUT"; then
  echo "postgres chart must not duplicate the deterministic CloudNativePG runtime identity" >&2
  exit 1
fi

if helm template invalid "$CHART" >/dev/null 2>&1; then
  echo "postgres chart accepted missing database credentials" >&2
  exit 1
fi

if helm template invalid-privileges-grace "$CHART" "${BASE_VALUES[@]}" \
  --set networkPolicy.enabled=false \
  --set privileges.jobDeadlineGraceSeconds=9 >/dev/null 2>&1; then
  echo "postgres chart accepted insufficient privileges Job deadline grace" >&2
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

if helm template missing-pooler-image "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set-string pooler.image= >/dev/null 2>&1; then
  echo "postgres chart accepted an enabled pooler without a pinned image" >&2
  exit 1
fi

if helm template missing-api-service "$CHART" \
  "${BASE_VALUES[@]}" \
  --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 >/dev/null 2>&1; then
  echo "postgres chart accepted an isolated pooler without Kubernetes API Service egress" >&2
  exit 1
fi

if helm template missing-api-endpoint "$CHART" \
  "${BASE_VALUES[@]}" \
  --set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 >/dev/null 2>&1; then
  echo "postgres chart accepted an isolated pooler without Kubernetes API endpoint egress" >&2
  exit 1
fi

for invalid_cidr in 10.43.0.0/24 2001:db8::/64 0.0.0.0/0 ::/0 not-a-cidr 999.43.0.1/32; do
  if helm template invalid-api-cidr "$CHART" \
    "${COMMON_VALUES[@]}" \
    --set-string "networkPolicy.kubernetesApiServerCidrs[0]=$invalid_cidr" >/dev/null 2>&1; then
    echo "postgres chart accepted non-host Kubernetes API CIDR '$invalid_cidr'" >&2
    exit 1
  fi
done

helm template valid-ipv6-api "$CHART" \
  "${BASE_VALUES[@]}" \
  --set-string networkPolicy.kubernetesApiServerCidrs[0]=fd00::1/128 \
  --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=2001:db8::2/128 >/dev/null

for invalid_port in 0 65536; do
  if helm template invalid-api-port "$CHART" \
    "${COMMON_VALUES[@]}" \
    --set "networkPolicy.kubernetesApiServerEndpointPort=$invalid_port" >/dev/null 2>&1; then
    echo "postgres chart accepted invalid Kubernetes API endpoint port '$invalid_port'" >&2
    exit 1
  fi
done

helm template one-database "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set-json 'databases=[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"}]' \
  >"$OUTPUT"
grep -q 'name: "opencrane_database_admin"' "$OUTPUT"
grep -q 'pg_read_all_data' "$OUTPUT"

helm template restored "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set restore.enabled=true \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
  --set restore.plugin.parameters.barmanObjectName=opencrane-postgres \
  --set-string restore.targetTime=2026-07-18T00:00:00Z \
  >"$OUTPUT"
grep -q 'source: "source"' "$OUTPUT"
grep -q 'targetTime: "2026-07-18T00:00:00Z"' "$OUTPUT"
grep -q 'barmanObjectName: opencrane-postgres' "$OUTPUT"
grep -q 'name: EXPECTED_BASELINE_SHA256' "$OUTPUT"
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

if helm template restored-without-baseline-proof "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set restore.enabled=true \
  --set-string bootstrap.targetBaseline.sha256= \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io >/dev/null 2>&1; then
  echo "postgres chart accepted recovery without a full target-baseline identity" >&2
  exit 1
fi

deploy_script="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
grep -q 'POSTGRES_BASELINE_SHA256=.*opencrane\\.ai/baseline-sha256' "$deploy_script"
grep -q 'bootstrap.targetBaseline.sha256=$POSTGRES_BASELINE_SHA256' "$deploy_script"

echo "postgres Helm contract: PASS"
