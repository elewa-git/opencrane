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
  --set backup.frequency=weekly \
  --set backup.retainedCopies=4 \
  --set backup.objectStore.name=opencrane-postgres-backups \
  --set backup.objectStore.configuration.destinationPath=s3://opencrane-postgres/ \
  >"$OUTPUT"

grep -q '^kind: Cluster$' "$OUTPUT"
test "$(grep -c '^kind: Cluster$' "$OUTPUT")" -eq 1
test "$(grep -c '^kind: Database$' "$OUTPUT")" -eq 3
test "$(grep -c 'helm.sh/resource-policy: keep' "$OUTPUT")" -eq 5
grep -q '^kind: Job$' "$OUTPUT"
grep -q 'helm.sh/hook: post-install,post-upgrade' "$OUTPUT"
test "$(grep -c 'app.kubernetes.io/component: postgres-database-privileges' "$OUTPUT")" -ge 2
grep -q 'REVOKE CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q 'GRANT CONNECT, TEMPORARY ON DATABASE' "$OUTPUT"
grep -q '^kind: ScheduledBackup$' "$OUTPUT"
grep -q '^kind: ObjectStore$' "$OUTPUT"
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
grep -q 'schedule: "0 0 2 \* \* 1"' "$OUTPUT"
grep -q 'retentionPolicy: "4w"' "$OUTPUT"
grep -q 'barmanObjectName: "opencrane-postgres-backups"' "$OUTPUT"
grep -q 'destinationPath: s3://opencrane-postgres/' "$OUTPUT"
grep -A 12 '^kind: ObjectStore$' "$OUTPUT" | grep -q 'helm.sh/resource-policy: keep'
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

function _assert_invalid_backup()
{
  local label="$1"
  shift
  if helm template "$label" "$CHART" "${COMMON_VALUES[@]}" --set backup.enabled=true "$@" >/dev/null 2>&1; then
    echo "postgres chart accepted $label backup configuration" >&2
    exit 1
  fi
}

_assert_invalid_backup missing-object-store
_assert_invalid_backup zero-retained-copies \
  --set backup.retainedCopies=0 \
  --set backup.objectStore.name=backups \
  --set backup.objectStore.configuration.destinationPath=s3://backups/
_assert_invalid_backup unsupported-frequency \
  --set backup.frequency=hourly \
  --set backup.objectStore.name=backups \
  --set backup.objectStore.configuration.destinationPath=s3://backups/

# Disabling a policy must remove new backup work, not the Barman recovery
# destination that a later restore names. Helm honours `resource-policy: keep`
# from the prior enabled release; this static contract proves both sides of the
# transition without requiring a live release history.
helm template backups-disabled "$CHART" \
  "${COMMON_VALUES[@]}" \
  --set backup.enabled=false \
  --set restore.enabled=true \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
  --set restore.plugin.parameters.barmanObjectName=opencrane-postgres-backups \
  >"$OUTPUT"
if grep -qE '^kind: (ScheduledBackup|ObjectStore)$' "$OUTPUT"; then
  echo "postgres chart left scheduling or a new ObjectStore manifest when backups are disabled" >&2
  exit 1
fi
grep -q 'barmanObjectName: opencrane-postgres-backups' "$OUTPUT"

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
