#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"obot","owner":"obot","credentialsSecret":"postgres-obot-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"}]'
POSTGRES_OPERAND_IMAGE='ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:0000000000000000000000000000000000000000000000000000000000000000'
BASE_VALUES=(--set-string "image=$POSTGRES_OPERAND_IMAGE" --set-json "databases=$DATABASES_JSON" --set-string databaseAdmin.name=opencrane_database_admin --set-string databaseAdmin.credentialsSecret=postgres-admin-bootstrap --set-string bootstrap.targetBaseline.sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=opencrane-database-baseline --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql --set-string networkPolicy.kubernetesApiServerCidrs[0]=10.43.0.1/32 --set-string networkPolicy.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32 --set networkPolicy.kubernetesApiServerEndpointPort=6443)

helm lint "$CHART" "${BASE_VALUES[@]}" >/dev/null
helm template opencrane-postgres "$CHART" "${BASE_VALUES[@]}" >"$OUTPUT"
grep -q '^kind: Cluster$' "$OUTPUT"
grep -q '^kind: Pooler$' "$OUTPUT"
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
# The chart must not grow a schema-mutation path back: initdb from the target baseline is
# the only way a schema reaches a database pre-1.0.
if grep -qi 'database-migration\|migration.sql' "$OUTPUT"; then
  echo "postgres chart renders a database-migration workload again" >&2
  exit 1
fi

echo "postgres helm contract: PASS"
