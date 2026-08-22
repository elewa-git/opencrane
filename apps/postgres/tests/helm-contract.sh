#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"obot","owner":"obot","credentialsSecret":"postgres-obot-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"}]'
POSTGRES_OPERAND_IMAGE='ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000'
BASE_VALUES=(--set-string "image=$POSTGRES_OPERAND_IMAGE" --set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.targetBaseline.sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline-deadbeef --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql --set-string convergence.targetSchemaVersion=0.8.0 --set-string convergence.targetBaselineSha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --set-string convergence.currentProtectedBaselineSha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
API_VALUES=(--set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 --set networkPolicy.kubernetesApiServerEndpointPort=6443)
COMMON_VALUES=("${BASE_VALUES[@]}" "${API_VALUES[@]}")
MIGRATION_VALUES=(--set migration.enabled=true --set-string migration.siloId=silo-1 --set-string migration.oidcIssuer=https://issuer.example --set convergence.previousMigration.available=true --set-string convergence.previousMigration.id=0.7.0-to-0.8.0 --set-string convergence.previousMigration.fromSchemaVersion=0.7.0 --set-string convergence.previousMigration.sourceTargetBaselineSha256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc --set-json 'convergence.previousMigration.sourceProtectedBaselineSha256s=["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]' --set-string convergence.previousMigration.selectedSourceProtectedBaselineSha256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --set-string convergence.previousMigration.sqlSha256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd --set-string migration.configMap.name=opencrane-database-migration-0-7-0-to-0-8-0-deadbeef --set-string migration.configMap.key=migration.sql)
PRIVILEGED_MIGRATION_VALUES=(--set superuserAccess.enabled=true --set migration.privilegedExtension.enabled=true --set-string migration.privilegedExtension.name=pg_cron)
GKE_AUTOPILOT_VALUES="$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/postgres-gke-autopilot.yaml"

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
grep -q 'kubernetes.io/metadata.name: "opencrane"' <<<"$POOLER_POLICY"
grep -q 'cnpg.io/poolerName: opencrane-postgres-pooler' <<<"$POOLER_POLICY"
grep -q 'cnpg.io/cluster: opencrane-postgres' <<<"$POOLER_POLICY"
grep -q '    - Egress' <<<"$POOLER_POLICY"
grep -q '          port: 5432' <<<"$POOLER_POLICY"
grep -q '          port: 53' <<<"$POOLER_POLICY"
grep -q '            cidr: "10.43.0.1/32"' <<<"$POOLER_POLICY"
grep -q '            cidr: "172.18.0.2/32"' <<<"$POOLER_POLICY"
grep -q '          port: 443' <<<"$POOLER_POLICY"
grep -q '          port: 6443' <<<"$POOLER_POLICY"
if grep -Eq 'app.kubernetes.io/component: (opencrane-server|mcp-gateway|litellm)' <<<"$INSTANCE_POLICY"; then
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
POOLER_RESOURCE_BLOCK="$(awk 'BEGIN { RS="---" } /kind: Pooler/ { print }' "$OUTPUT")"
if grep -q 'name: opencrane-postgres-pooler-client' "$OUTPUT"; then
  echo "postgres chart must not create a headless Pooler client Service; consumers use CNPG's stable Pooler Service" >&2
  exit 1
fi
grep -q 'cpu: 250m' <<<"$POOLER_RESOURCE_BLOCK"
grep -q 'memory: 256Mi' <<<"$POOLER_RESOURCE_BLOCK"
grep -q 'cpu: 100m' <<<"$POOLER_RESOURCE_BLOCK"
grep -q 'memory: 128Mi' <<<"$POOLER_RESOURCE_BLOCK"
grep -q 'poolMode: "session"' "$OUTPUT"
grep -q 'max_client_conn: "50"' "$OUTPUT"
grep -q 'max_db_connections: "10"' "$OUTPUT"
grep -q 'max_connections: "80"' "$OUTPUT"
grep -A1 'shared_preload_libraries:' "$OUTPUT" | grep -q -- '- pg_cron'
if grep -q 'shared_preload_libraries: "pg_cron"' "$OUTPUT"; then
  echo "postgres chart must use CloudNativePG's dedicated shared_preload_libraries field" >&2
  exit 1
fi
grep -q 'cron.database_name: "opencrane"' "$OUTPUT"
grep -Fq "imageName: \"$POSTGRES_OPERAND_IMAGE\"" "$OUTPUT"
test "$(grep -c '^kind: Database$' "$OUTPUT")" -eq 2
test "$(grep -c 'helm.sh/resource-policy: keep' "$OUTPUT")" -eq 3
grep -q '^kind: Job$' "$OUTPUT"
if grep -q 'name: opencrane-postgres-database-migration' "$OUTPUT"; then
  echo "fresh/current render unexpectedly created a database migration workload" >&2
  exit 1
fi
grep -q 'helm.sh/hook: post-install,post-upgrade' "$OUTPUT"
grep -q 'activeDeadlineSeconds: 330' "$OUTPUT"
test "$(grep -c 'app.kubernetes.io/component: postgres-database-privileges' "$OUTPUT")" -ge 2
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'GRANT CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q -- '--single-transaction' "$OUTPUT"
test "$(grep -c 'until psql' "$OUTPUT")" -eq 3
test "$(grep -c 'cpu: 50m' "$OUTPUT")" -eq 3
test "$(grep -c 'memory: 64Mi' "$OUTPUT")" -eq 3
grep -q 'until recorded_origin=' "$OUTPUT"
grep -q "Timed out proving schema convergence for logical database" "$OUTPUT"
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

GKE_PRIVILEGES_JOB="$(helm template opencrane-postgres "$CHART" \
  --namespace opencrane \
  "${COMMON_VALUES[@]}" \
  --values "$GKE_AUTOPILOT_VALUES" \
  | awk 'BEGIN { RS="---" } /kind: Job/ && /name: opencrane-postgres-database-privileges/ { print }')"
[[ -n "$GKE_PRIVILEGES_JOB" ]]
grep -Fq 'cloud.google.com/compute-class: opencrane-database-proof' <<<"$GKE_PRIVILEGES_JOB"
grep -q -- '- ReadWriteOnce' "$OUTPUT"
grep -q 'storageClass: "expandable-rwo"' "$OUTPUT"
grep -q 'name: "postgres-opencrane-bootstrap"' "$OUTPUT"
grep -q 'name: "postgres-obot-bootstrap"' "$OUTPUT"
grep -q 'name: "postgres-litellm-bootstrap"' "$OUTPUT"
grep -q 'postInitApplicationSQLRefs:' "$OUTPUT"
grep -q 'key: target-baseline.sql' "$OUTPUT"
grep -q 'name: "obot"' "$OUTPUT"
grep -q 'name: "litellm"' "$OUTPUT"
grep -q 'createdb: false' "$OUTPUT"
grep -q 'createrole: false' "$OUTPUT"
grep -q 'method: plugin' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server' "$OUTPUT"
grep -q 'app.kubernetes.io/component: mcp-gateway' "$OUTPUT"
grep -q 'app.kubernetes.io/component: litellm' "$OUTPUT"
grep -q 'name: CURRENT_SCHEMA_VERSION' "$OUTPUT"
grep -q 'name: TARGET_BASELINE_SHA256' "$OUTPUT"
grep -q 'name: CURRENT_PROTECTED_BASELINE_SHA256' "$OUTPUT"
grep -q 'SELECT "baseline_sha256" FROM "opencrane_bootstrap"."target_baseline"' "$OUTPUT"
grep -Fq "<<'SQL'" "$OUTPUT"
if grep -Fq -- '-c "SELECT count(*) = 1 FROM opencrane_migrations.schema_history' "$OUTPUT"; then
  echo "postgres privilege proof must let psql substitute bound history values" >&2
  exit 1
fi
grep -q 'is not an exact fresh or migrated' "$OUTPUT"

PRIVILEGE_SCRIPT_FILE="$(mktemp)"
PSQL_STUB_DIR="$(mktemp -d)"
trap 'rm -f "$OUTPUT" "$PRIVILEGE_SCRIPT_FILE"; rm -rf "$PSQL_STUB_DIR"' EXIT
node - "$OUTPUT" >"$PRIVILEGE_SCRIPT_FILE" <<'NODE'
const { readFileSync } = require("node:fs");
const { parseAllDocuments } = require("yaml");
const documents = parseAllDocuments(readFileSync(process.argv[2], "utf8")).map((document) => document.toJSON());
const job = documents.find((document) => document?.kind === "Job"
  && document.metadata?.name === "opencrane-postgres-database-privileges");
const container = job.spec.template.spec.containers.find((candidate) => candidate.name === "opencrane-privileges");
process.stdout.write(container.args[0]);
NODE
printf '%s\n' '#!/bin/sh' \
  'input="$(cat)"' \
  'case "$*" in' \
  '  *opencrane_bootstrap*) printf "%s\n" "$SELECTED_SOURCE_PROTECTED_BASELINE_SHA256" ;;' \
  '  *to_regclass*) printf "%s\n" t ;;' \
  '  *)' \
  '    if printf "%s\n" "$input" | grep -q schema_history; then' \
  '      if printf "%s\n" "$input" | grep -Eq "^[[:space:]]*SQL$"; then exit 70; fi' \
  '      printf "%s\n" t' \
  '    fi' \
  '    ;;' \
  'esac' >"$PSQL_STUB_DIR/psql"
chmod +x "$PSQL_STUB_DIR/psql"
PATH="$PSQL_STUB_DIR:$PATH" \
PGDATABASE=opencrane \
PGUSER=opencrane \
CURRENT_SCHEMA_VERSION=0.8.0 \
TARGET_BASELINE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
CURRENT_PROTECTED_BASELINE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
PREVIOUS_MIGRATION_AVAILABLE=true \
PREVIOUS_MIGRATION_ID=0.7.0-to-0.8.0 \
PREVIOUS_MIGRATION_SQL_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
PREVIOUS_SCHEMA_VERSION=0.7.0 \
SELECTED_SOURCE_PROTECTED_BASELINE_SHA256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
/bin/sh "$PRIVILEGE_SCRIPT_FILE"

if grep -qE '^kind: (ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$OUTPUT"; then
  echo "postgres chart must not duplicate the deterministic CloudNativePG runtime identity" >&2
  exit 1
fi

MIGRATION_OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT" "$MIGRATION_OUTPUT" "$PRIVILEGE_SCRIPT_FILE"; rm -rf "$PSQL_STUB_DIR"' EXIT
helm template opencrane-postgres "$CHART" --namespace opencrane \
  "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" >"$MIGRATION_OUTPUT"
MIGRATION_JOB="$(awk 'BEGIN { RS="---" } /kind: Job/ && /name: opencrane-postgres-database-migration/ { print }' "$MIGRATION_OUTPUT")"
MIGRATION_POLICY="$(awk 'BEGIN { RS="---" } /kind: NetworkPolicy/ && /name: opencrane-postgres-database-migration/ { print }' "$MIGRATION_OUTPUT")"
[[ -n "$MIGRATION_JOB" && -n "$MIGRATION_POLICY" ]]
grep -q 'helm.sh/hook: post-install,post-upgrade' <<<"$MIGRATION_JOB"
grep -q 'helm.sh/hook-weight: "-20"' <<<"$MIGRATION_JOB"
grep -q 'backoffLimit: 0' <<<"$MIGRATION_JOB"
grep -q 'activeDeadlineSeconds: 930' <<<"$MIGRATION_JOB"
grep -q 'ttlSecondsAfterFinished: 86400' <<<"$MIGRATION_JOB"
grep -q 'automountServiceAccountToken: false' <<<"$MIGRATION_JOB"
grep -q 'readOnlyRootFilesystem: true' <<<"$MIGRATION_JOB"
grep -q 'runAsNonRoot: true' <<<"$MIGRATION_JOB"
grep -q 'emptyDir:' <<<"$MIGRATION_JOB"
grep -q 'sha256sum /migration/migration.sql' <<<"$MIGRATION_JOB"
grep -q 'migration_sql_sha256=' <<<"$MIGRATION_JOB"
grep -q 'name: SOURCE_PROTECTED_BASELINE_SHA256' <<<"$MIGRATION_JOB"
grep -q 'value: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"' <<<"$MIGRATION_JOB"
grep -q 'ghcr.io/cloudnative-pg/postgresql@sha256:b1deeed2aa998b2f381e39c5cadb9ec06127708c8bd62965743af19abf21628f' <<<"$MIGRATION_JOB"
grep -q 'ingress: \[\]' <<<"$MIGRATION_POLICY"
grep -q 'cnpg.io/cluster: opencrane-postgres' <<<"$MIGRATION_POLICY"
grep -q 'port: 5432' <<<"$MIGRATION_POLICY"
grep -q 'port: 53' <<<"$MIGRATION_POLICY"
if grep -qE '^kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$MIGRATION_OUTPUT"; then
  echo "database migration Job received Kubernetes RBAC" >&2
  exit 1
fi
test "$(grep -c '^kind: ServiceAccount$' "$MIGRATION_OUTPUT")" -eq 1
grep -q 'app.kubernetes.io/component: postgres-database-migration' <<<"$INSTANCE_POLICY$(cat "$MIGRATION_OUTPUT")"
grep -q 'helm.sh/hook-weight: "-10"' "$MIGRATION_OUTPUT"
grep -q 'sql_sha256' "$MIGRATION_OUTPUT"
grep -q 'name: SELECTED_SOURCE_PROTECTED_BASELINE_SHA256' "$MIGRATION_OUTPUT"
if grep -q 'name: POSTGRES_SUPERUSER_PASSWORD' <<<"$MIGRATION_JOB"; then
  echo "ordinary database migrations must not receive a CNPG superuser credential" >&2
  exit 1
fi

PRIVILEGED_MIGRATION_OUTPUT="$(helm template opencrane-postgres "$CHART" --namespace opencrane \
  "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" "${PRIVILEGED_MIGRATION_VALUES[@]}")"
PRIVILEGED_MIGRATION_JOB="$(awk 'BEGIN { RS="---" } /kind: Job/ && /name: opencrane-postgres-database-migration/ { print }' <<<"$PRIVILEGED_MIGRATION_OUTPUT")"
grep -q 'enableSuperuserAccess: true' <<<"$PRIVILEGED_MIGRATION_OUTPUT"
grep -q 'CREATE EXTENSION IF NOT EXISTS pg_cron' <<<"$PRIVILEGED_MIGRATION_JOB"
grep -q 'GRANT USAGE ON SCHEMA cron TO :"application_owner"' <<<"$PRIVILEGED_MIGRATION_JOB"
grep -q -- '--file -' <<<"$PRIVILEGED_MIGRATION_JOB"
if grep -q -- '--command.*GRANT USAGE ON SCHEMA cron' <<<"$PRIVILEGED_MIGRATION_JOB"; then
  echo "privileged extension SQL must use psql file input so variable quoting is applied" >&2
  exit 1
fi
grep -q 'name: POSTGRES_APPLICATION_OWNER' <<<"$PRIVILEGED_MIGRATION_JOB"
grep -q 'name: "opencrane-postgres-superuser"' <<<"$PRIVILEGED_MIGRATION_JOB"

REVOKED_PRIVILEGED_VALUES=(--set superuserAccess.enabled=false --set migration.privilegedExtension.enabled=false --set-string migration.privilegedExtension.name=pg_cron)
REVOKED_PRIVILEGED_OUTPUT="$(helm template opencrane-postgres "$CHART" --namespace opencrane \
  "${COMMON_VALUES[@]}" "${REVOKED_PRIVILEGED_VALUES[@]}")"
grep -q 'enableSuperuserAccess: false' <<<"$REVOKED_PRIVILEGED_OUTPUT"
if grep -q 'POSTGRES_SUPERUSER_PASSWORD' <<<"$REVOKED_PRIVILEGED_OUTPUT"; then
  echo "postgres chart retained the superuser credential after the privileged migration step" >&2
  exit 1
fi

if helm template privileged-extension-without-access "$CHART" --namespace opencrane \
  "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" \
  --set migration.privilegedExtension.enabled=true --set-string migration.privilegedExtension.name=pg_cron >/dev/null 2>&1; then
  echo "postgres chart accepted a privileged extension migration without temporary superuser access" >&2
  exit 1
fi
if helm template unreviewed-privileged-extension "$CHART" --namespace opencrane \
  "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" \
  --set superuserAccess.enabled=true --set migration.privilegedExtension.enabled=true \
  --set-string migration.privilegedExtension.name=pg_stat_statements >/dev/null 2>&1; then
  echo "postgres chart accepted an unreviewed privileged extension migration" >&2
  exit 1
fi

if helm template unadmitted-selected-origin "$CHART" "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" \
  --set-string convergence.previousMigration.selectedSourceProtectedBaselineSha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  >/dev/null 2>&1; then
  echo "postgres chart accepted a selected origin outside the admitted set" >&2
  exit 1
fi

helm template current-with-migration-evidence "$CHART" "${COMMON_VALUES[@]}" \
  --set convergence.previousMigration.available=true \
  --set-string convergence.previousMigration.id=0.7.0-to-0.8.0 \
  --set-string convergence.previousMigration.fromSchemaVersion=0.7.0 \
  --set-string convergence.previousMigration.sourceTargetBaselineSha256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  --set-json 'convergence.previousMigration.sourceProtectedBaselineSha256s=["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]' \
  --set-string convergence.previousMigration.selectedSourceProtectedBaselineSha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string convergence.previousMigration.sqlSha256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  >/dev/null

if helm template invalid-migration-image "$CHART" "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" \
  --set-string migration.image=ghcr.io/cloudnative-pg/postgresql:17.5 >/dev/null 2>&1; then
  echo "postgres chart accepted a tag-only database migration image" >&2
  exit 1
fi

RESTORE_MIGRATION_OUTPUT="$(helm template restored-previous "$CHART" "${COMMON_VALUES[@]}" "${MIGRATION_VALUES[@]}" \
  --set restore.enabled=true --set-string restore.plugin.name=barman-cloud.cloudnative-pg.io)"
grep -q '^    recovery:' <<<"$RESTORE_MIGRATION_OUTPUT"
grep -q 'helm.sh/hook: post-install,post-upgrade' <<<"$RESTORE_MIGRATION_OUTPUT"

if helm template invalid "$CHART" >/dev/null 2>&1; then
  echo "postgres chart accepted missing database credentials" >&2
  exit 1
fi

if helm template tag-only-operand "$CHART" "${COMMON_VALUES[@]}" \
  --set-string image=ghcr.io/elewa-git/opencrane-postgres:0.9.3 >/dev/null 2>&1; then
  echo "postgres chart accepted a tag-only database operand image" >&2
  exit 1
fi

if helm template digest-only-operand "$CHART" "${COMMON_VALUES[@]}" \
  --set-string image=ghcr.io/elewa-git/opencrane-postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000 >/dev/null 2>&1; then
  echo "postgres chart accepted a digest-only database operand image that CloudNativePG cannot upgrade" >&2
  exit 1
fi

if helm template unversioned-tag-operand "$CHART" "${COMMON_VALUES[@]}" \
  --set-string image=ghcr.io/elewa-git/opencrane-postgres:sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000 >/dev/null 2>&1; then
  echo "postgres chart accepted an operand tag without a PostgreSQL version" >&2
  exit 1
fi

if helm template wrong-major-operand "$CHART" "${COMMON_VALUES[@]}" \
  --set-string image=ghcr.io/elewa-git/opencrane-postgres:16.9-sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000 >/dev/null 2>&1; then
  echo "postgres chart accepted an operand tag for the wrong PostgreSQL major" >&2
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
grep -q 'name: CURRENT_PROTECTED_BASELINE_SHA256' "$OUTPUT"
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
orchestrator="$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-migration-orchestrator.sh"
grep -q 'POSTGRES_BASELINE_SHA256=.*opencrane\\.ai/baseline-sha256' "$deploy_script"
grep -q 'bootstrap.targetBaseline.sha256=$POSTGRES_BOOTSTRAP_BASELINE_SHA256' "$orchestrator"
grep -q 'refusing to rewrite Cluster bootstrap provenance' "$deploy_script"

echo "postgres Helm contract: PASS"
