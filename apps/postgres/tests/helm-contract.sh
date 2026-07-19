#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/postgres/helm"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

helm lint "$CHART" --set credentials.existingSecret=postgres-bootstrap >/dev/null
helm template opencrane-postgres "$CHART" \
  --namespace opencrane \
  --set credentials.existingSecret=postgres-bootstrap \
  --set storage.storageClass=expandable-rwo \
  --set backup.enabled=true \
  --set backup.plugin.name=barman-cloud.cloudnative-pg.io \
  --set backup.plugin.parameters.barmanObjectName=opencrane-postgres \
  >"$OUTPUT"

grep -q '^kind: Cluster$' "$OUTPUT"
grep -q '^kind: ScheduledBackup$' "$OUTPUT"
grep -q '^kind: NetworkPolicy$' "$OUTPUT"
grep -q 'helm.sh/resource-policy: keep' "$OUTPUT"
grep -q 'opencrane.ai/cnpg-service-account: "opencrane-postgres"' "$OUTPUT"
grep -q 'size: "20Gi"' "$OUTPUT"
grep -q 'resizeInUseVolumes: true' "$OUTPUT"
grep -q -- '- ReadWriteOnce' "$OUTPUT"
grep -q 'storageClass: "expandable-rwo"' "$OUTPUT"
grep -q 'name: "postgres-bootstrap"' "$OUTPUT"
grep -q 'method: plugin' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server' "$OUTPUT"
grep -q 'app.kubernetes.io/component: opencrane-server-migrate' "$OUTPUT"

if grep -qE '^kind: (ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$OUTPUT"; then
  echo "postgres chart must not duplicate the deterministic CloudNativePG runtime identity" >&2
  exit 1
fi

if helm template invalid "$CHART" >/dev/null 2>&1; then
  echo "postgres chart accepted missing credentials.existingSecret" >&2
  exit 1
fi

helm template restored "$CHART" \
  --set credentials.existingSecret=postgres-bootstrap \
  --set restore.enabled=true \
  --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
  --set restore.plugin.parameters.barmanObjectName=opencrane-postgres \
  --set-string restore.targetTime=2026-07-18T00:00:00Z \
  >"$OUTPUT"
grep -q 'source: "source"' "$OUTPUT"
grep -q 'targetTime: "2026-07-18T00:00:00Z"' "$OUTPUT"
grep -q 'barmanObjectName: opencrane-postgres' "$OUTPUT"

echo "postgres Helm contract: PASS"
