#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

DATABASES_JSON='[{"name":"opencrane","owner":"opencrane","credentialsSecret":"postgres-opencrane-bootstrap"},{"name":"obot","owner":"obot","credentialsSecret":"postgres-obot-bootstrap"},{"name":"litellm","owner":"litellm","credentialsSecret":"postgres-litellm-bootstrap"},{"name":"langfuse","owner":"langfuse","credentialsSecret":"postgres-langfuse-bootstrap"}]'
COMMON_VALUES=(--set-json "databases=$DATABASES_JSON")

helm lint "$CHART" "${COMMON_VALUES[@]}" >/dev/null
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
test "$(grep -c '^kind: Database$' "$OUTPUT")" -eq 3
test "$(grep -c 'helm.sh/resource-policy: keep' "$OUTPUT")" -eq 4
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'helm.sh/hook: post-install,post-upgrade' "$OUTPUT"
test "$(grep -c 'app.kubernetes.io/component: postgres-database-privileges' "$OUTPUT")" -ge 2
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'GRANT CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
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
grep -q 'name: "obot"' "$OUTPUT"
grep -q 'name: "litellm"' "$OUTPUT"
grep -q 'name: "langfuse"' "$OUTPUT"
grep -q 'createdb: false' "$OUTPUT"
grep -q 'createrole: false' "$OUTPUT"
grep -q 'method: plugin' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server-migrate' "$OUTPUT"

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

echo "postgres Helm contract: PASS"
