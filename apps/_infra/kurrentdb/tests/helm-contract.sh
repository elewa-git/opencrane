#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ensure_umbrella_chart_dependencies

VALUES=(--set historyStore.kurrentdb.enabled=true --set historyStore.kurrentdb.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --set historyStore.kurrentdb.tls.existingSecret=kurrentdb-tls --set historyStore.kurrentdb.bootstrapAdmin.existingSecret=kurrentdb-bootstrap --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --show-only templates/app-rollups.yaml)"
grep -Fq 'kind: StatefulSet' <<<"$rendered"
grep -Fq 'name: opencrane-testv5-kurrentdb' <<<"$rendered"
grep -Fq 'value: "false"' <<<"$rendered"
grep -Fq 'automountServiceAccountToken: false' <<<"$rendered"
grep -Fq 'runAsNonRoot: true' <<<"$rendered"
grep -Fq 'runAsUser: 1001' <<<"$rendered"
grep -Fq 'allowPrivilegeEscalation: false' <<<"$rendered"
grep -Fq 'drop: ["ALL"]' <<<"$rendered"
grep -Fq 'type: RuntimeDefault' <<<"$rendered"
grep -Fq 'defaultMode: 0440' <<<"$rendered"
grep -Fq 'checksum/kurrentdb-tls:' <<<"$rendered"
grep -Fq 'checksum/kurrentdb-bootstrap-admin:' <<<"$rendered"
grep -Fq 'ingress: []' <<<"$rendered"
grep -Fq 'egress: []' <<<"$rendered"

if helm template opencrane-testv5 "$CHART_DIR" --set historyStore.kurrentdb.enabled=true "${VALUES[@]:4}" >/dev/null 2>&1; then
  echo "KurrentDB rendered without an immutable image digest" >&2
  exit 1
fi

echo "KurrentDB Helm contract: PASS"
