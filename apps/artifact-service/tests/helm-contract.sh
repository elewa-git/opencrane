#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/_infra/deploy-k8s"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

helm dependency build "$CHART" >/dev/null
helm template opencrane "$CHART" >"$OUTPUT"

grep -q 'name: opencrane-artifact-service' "$OUTPUT"
grep -q 'namespace: default-artifacts' "$OUTPUT"
grep -q 'kind: PersistentVolumeClaim' "$OUTPUT"
grep -q 'storage: "20Gi"' "$OUTPUT"
grep -q 'accessModes: \["ReadWriteOnce"\]' "$OUTPUT"
grep -q 'automountServiceAccountToken: false' "$OUTPUT"
grep -q 'mountPath: /var/lib/opencrane/artifacts' "$OUTPUT"
grep -q 'key: lease-public.pem' "$OUTPUT"
grep -q 'key: receipt-private.pem' "$OUTPUT"
grep -q 'key: lease-private.pem' "$OUTPUT"
grep -q 'key: receipt-public.pem' "$OUTPUT"
grep -q 'secretName: "opencrane-artifact-catalog-keys"' "$OUTPUT"
grep -q 'secretName: "opencrane-artifact-service-keys"' "$OUTPUT"
grep -q 'readOnlyRootFilesystem: true' "$OUTPUT"
grep -q 'app.kubernetes.io/component: artifact-service' "$OUTPUT"

if grep -A40 'name: opencrane-artifact-service' "$OUTPUT" | grep -qE 'kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)'; then
  echo "artifact service must not receive Kubernetes API permissions" >&2
  exit 1
fi

if grep -q 'name: opencrane-opencrane-server-default' "$OUTPUT"; then
  echo "opencrane server must not retain the legacy cluster-wide RBAC role" >&2
  exit 1
fi

echo "artifact-service Helm contract: PASS"
