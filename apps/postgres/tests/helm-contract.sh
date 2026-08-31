#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"}]'
POSTGRES_OPERAND_IMAGE='ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000'
BASE_VALUES=(--set-string "image=$POSTGRES_OPERAND_IMAGE" --set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.targetBaseline.sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql --set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 --set networkPolicy.kubernetesApiServerEndpointPort=6443)

helm lint "$CHART" "${BASE_VALUES[@]}" >/dev/null
helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" >"$OUTPUT"
grep -q '^kind: Cluster$' "$OUTPUT"
grep -q '^kind: Pooler$' "$OUTPUT"
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'name: opencrane-postgres-opencrane' "$OUTPUT"
grep -q 'name: pg_cron' "$OUTPUT"
grep -q 'name: cron' "$OUTPUT"
grep -q 'owner: "opencrane"' "$OUTPUT"
grep -q 'databaseReclaimPolicy: retain' "$OUTPUT"
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
if grep -q 'schema convergence\|CURRENT_SCHEMA_VERSION\|SELECTED_SOURCE_PROTECTED_BASELINE_SHA256' "$OUTPUT"; then
  echo "privilege job still performs a schema-state migration safeguard" >&2
  exit 1
fi

# The PostgreSQL deployer reuses saved release values during upgrades. Render a saved legacy
# selector to prove it no longer adds a node selector while both database checks keep their normal
# resource requests.
helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" \
  --set-json 'privileges.nodeSelector={"cloud.google.com/compute-class":"opencrane-database-proof"}' \
  --show-only templates/database-privileges-job.yaml >"$OUTPUT"
if grep -q 'nodeSelector:\|compute-class' "$OUTPUT"; then
  echo "privilege job still renders the legacy scheduler selector" >&2
  exit 1
fi
[[ "$(grep -c '^        - name: opencrane-privileges$' "$OUTPUT")" == "1" ]]
[[ "$(grep -c '^        - name: litellm-privileges$' "$OUTPUT")" == "1" ]]
[[ "$(grep -c '^        - name:' "$OUTPUT")" == "2" ]]
[[ "$(grep -c '^        - name: .*privileges$' "$OUTPUT")" == "2" ]]
[[ "$(grep -c '^              cpu: 50m$' "$OUTPUT")" == "2" ]]
[[ "$(grep -c '^              memory: 64Mi$' "$OUTPUT")" == "2" ]]

helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" --set pgCron.assignSchemaOwnership=false --show-only templates/databases.yaml >"$OUTPUT"
grep -q 'name: pg_cron' "$OUTPUT"
if grep -q 'name: cron' "$OUTPUT"; then
  echo "pg_cron extension-only stage still assigns cron schema ownership" >&2
  exit 1
fi

helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" >"$OUTPUT"
# The chart must not grow a schema-mutation path back: initdb from the target baseline is
# the only way a schema reaches a database pre-1.0.
if grep -qi 'database-migration\|migration.sql' "$OUTPUT"; then
  echo "postgres chart renders a database-migration workload again" >&2
  exit 1
fi

echo "postgres helm contract: PASS"
