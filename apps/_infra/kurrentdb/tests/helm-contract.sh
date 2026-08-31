#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ensure_umbrella_chart_dependencies

VALUES=(
  --set historyStore.kurrentdb.enabled=true
  --set historyStore.kurrentdb.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  --set historyStore.kurrentdb.tls.existingSecret=kurrentdb-tls
  --set historyStore.kurrentdb.bootstrapAdmin.existingSecret=kurrentdb-bootstrap-admin
  --set historyStore.kurrentdb.bootstrapOps.existingSecret=kurrentdb-bootstrap-ops
  --set historyStore.kurrentdb.serviceCredential.existingSecret=kurrentdb-history-service
  --set historyStore.kurrentdb.bootstrap.image.repository=curlimages/curl
  --set historyStore.kurrentdb.bootstrap.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  --set historyStore.kurrentdb.bootstrap.image.pullPolicy=IfNotPresent
  --set historyStore.kurrentdb.bootstrap.timeoutSeconds=300
  --set historyStore.kurrentdb.bootstrap.activeDeadlineSeconds=330
  --set historyStore.kurrentdb.bootstrap.backoffLimit=0
  --set historyStore.kurrentdb.bootstrap.resources.requests.cpu=50m
  --set historyStore.kurrentdb.bootstrap.resources.requests.memory=64Mi
  --set historyStore.kurrentdb.bootstrap.resources.limits.cpu=100m
  --set historyStore.kurrentdb.bootstrap.resources.limits.memory=128Mi
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
)

rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --show-only templates/app-rollups.yaml)"
grep -Fq 'kind: StatefulSet' <<<"$rendered"
grep -Fq 'name: opencrane-testv5-kurrentdb' <<<"$rendered"
grep -Fq 'kind: Job' <<<"$rendered"
grep -Fq 'name: opencrane-testv5-kurrentdb-bootstrap' <<<"$rendered"
grep -Fq 'value: "false"' <<<"$rendered"
grep -Fq 'name: KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS' <<<"$rendered"
grep -Fq 'name: KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS' <<<"$rendered"
grep -Fq 'name: KURRENTDB_DEFAULT_OPS_PASSWORD' <<<"$rendered"
grep -Fq 'automountServiceAccountToken: false' <<<"$rendered"
grep -Fq 'runAsNonRoot: true' <<<"$rendered"
grep -Fq 'runAsUser: 1001' <<<"$rendered"
grep -Fq 'runAsUser: 65532' <<<"$rendered"
grep -Fq 'allowPrivilegeEscalation: false' <<<"$rendered"
grep -Fq 'readOnlyRootFilesystem: true' <<<"$rendered"
grep -Fq 'drop: ["ALL"]' <<<"$rendered"
grep -Fq 'type: RuntimeDefault' <<<"$rendered"
grep -Fq 'defaultMode: 0440' <<<"$rendered"
grep -Fq 'checksum/kurrentdb-tls:' <<<"$rendered"
grep -Fq 'checksum/kurrentdb-bootstrap-admin:' <<<"$rendered"
grep -Fq 'checksum/kurrentdb-bootstrap-ops:' <<<"$rendered"
grep -Fq 'Kurrent-ExpectedVersion: -1' <<<"$rendered"
grep -Fq 'Content-Type: application/vnd.kurrent.events+json' <<<"$rendered"
grep -Fq 'eventType": "opencrane-history-default-acl"' <<<"$rendered"
grep -Fq '"$userStreamAcl"' <<<"$rendered"
grep -Fq '"$d": "$admins"' <<<"$rendered"
grep -Fq 'jq -e' <<<"$rendered"
grep -Fq 'app.kubernetes.io/component: opencrane-server' <<<"$rendered"
grep -Fq 'app.kubernetes.io/component: kurrentdb-bootstrap' <<<"$rendered"
grep -Fq 'egress: []' <<<"$rendered"

if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]:0:1}" "${VALUES[@]:2}" >/dev/null 2>&1; then
  echo "KurrentDB rendered without an immutable image digest" >&2
  exit 1
fi

if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]:0:5}" "${VALUES[@]:6}" >/dev/null 2>&1; then
  echo "KurrentDB rendered without the required service credential" >&2
  exit 1
fi

if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]:0:7}" "${VALUES[@]:8}" >/dev/null 2>&1; then
  echo "KurrentDB rendered without a digest-pinned bootstrap image" >&2
  exit 1
fi

echo "KurrentDB Helm contract: PASS"
