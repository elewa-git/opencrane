#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap cleanup_current_chart_sources EXIT
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"

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
grep -Fq 'activation_stream="computer-activations-opencrane-testv5"' <<<"$rendered"
grep -Fq 'activation_group="conversation-computer-activation"' <<<"$rendered"
grep -Fq 'subscription_url="$endpoint/subscriptions/$activation_stream/$activation_group"' <<<"$rendered"
grep -Fq -- '--user "admin:$admin_password" --request PUT' <<<"$rendered"
grep -Fq 'maxSubscriberCount: 4' <<<"$rendered"
grep -Fq 'messageTimeoutMilliseconds: 60000' <<<"$rendered"
grep -Fq 'maxRetryCount: 60' <<<"$rendered"
if grep -F -- '--user "$history_username:$history_password" --request PUT' <<<"$rendered"; then
  echo "HistoryStore service credentials gained persistent-subscription administration" >&2
  exit 1
fi
grep -Fq 'app.kubernetes.io/component: opencrane-server' <<<"$rendered"
grep -Fq 'app.kubernetes.io/component: kurrentdb-bootstrap' <<<"$rendered"
grep -Fq 'egress: []' <<<"$rendered"
server_deployment="$(awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-testv5-opencrane-server/ { print }' <<<"$rendered")"
[[ -n "$server_deployment" ]]
grep -Fq 'name: OPENCRANE_HISTORY_STORE_ENDPOINT' <<<"$server_deployment"
grep -Fq 'value: "opencrane-testv5-kurrentdb.default.svc:2113"' <<<"$server_deployment"
grep -Fq 'name: OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH' <<<"$server_deployment"
grep -Fq 'value: /var/run/opencrane/history-store/tls/ca.crt' <<<"$server_deployment"
grep -Fq 'name: OPENCRANE_HISTORY_STORE_USERNAME_PATH' <<<"$server_deployment"
grep -Fq 'name: OPENCRANE_HISTORY_STORE_PASSWORD_PATH' <<<"$server_deployment"
grep -Fq 'name: history-store-tls' <<<"$server_deployment"
grep -Fq 'name: history-store-credential' <<<"$server_deployment"
grep -Fq 'mountPath: /var/run/opencrane/history-store/tls' <<<"$server_deployment"
grep -Fq 'mountPath: /var/run/opencrane/history-store/credentials' <<<"$server_deployment"
grep -Fq 'secretName: "kurrentdb-tls"' <<<"$server_deployment"
grep -Fq 'secretName: "kurrentdb-history-service"' <<<"$server_deployment"
grep -Fq 'path: ca.crt' <<<"$server_deployment"
grep -Fq 'path: username' <<<"$server_deployment"
grep -Fq 'path: password' <<<"$server_deployment"

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

# Resilience: TLS HTTP health probes and a disruption budget on the single node.
kurrentdb_statefulset="$(awk 'BEGIN { RS="---" } /kind: StatefulSet/ && /name: opencrane-testv5-kurrentdb/ { print }' <<<"$rendered")"
[[ -n "$kurrentdb_statefulset" ]]
[[ "$(grep -Fc 'path: /health/live' <<<"$kurrentdb_statefulset")" == "2" ]]
[[ "$(grep -Fc 'scheme: HTTPS' <<<"$kurrentdb_statefulset")" == "2" ]]
if grep -Fq 'tcpSocket:' <<<"$kurrentdb_statefulset"; then
  echo "KurrentDB probes still only open the TCP socket" >&2
  exit 1
fi
grep -Fq 'replicas: 1' <<<"$kurrentdb_statefulset"
kurrentdb_pdb="$(awk 'BEGIN { RS="---" } /kind: PodDisruptionBudget/ && /name: opencrane-testv5-kurrentdb\n/ { print }' <<<"$rendered")"
[[ -n "$kurrentdb_pdb" ]]
grep -Fq 'minAvailable: 1' <<<"$kurrentdb_pdb"
grep -Fq 'app.kubernetes.io/component: kurrentdb' <<<"$kurrentdb_pdb"

# Backup (default fileCopy mode): CronJob on the database node, keep-on-uninstall archive, no network.
backup_cronjob="$(awk 'BEGIN { RS="---" } /kind: CronJob/ && /name: opencrane-testv5-kurrentdb-backup/ { print }' <<<"$rendered")"
[[ -n "$backup_cronjob" ]]
grep -Fq 'opencrane.ai/kurrentdb-backup-mode: fileCopy' <<<"$backup_cronjob"
grep -Fq 'schedule: "0 2 * * *"' <<<"$backup_cronjob"
grep -Fq 'concurrencyPolicy: Forbid' <<<"$backup_cronjob"
grep -Fq 'serviceAccountName: opencrane-testv5-kurrentdb-backup' <<<"$backup_cronjob"
grep -Fq 'automountServiceAccountToken: false' <<<"$backup_cronjob"
grep -Fq 'topologyKey: kubernetes.io/hostname' <<<"$backup_cronjob"
grep -Fq 'runAsUser: 1001' <<<"$backup_cronjob"
grep -Fq 'image: "curlimages/curl@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' <<<"$backup_cronjob"
grep -Fq 'command: ["/bin/sh", "/opt/opencrane/kurrentdb-backup/backup.sh"]' <<<"$backup_cronjob"
grep -Fq 'claimName: data-opencrane-testv5-kurrentdb-0' <<<"$backup_cronjob"
grep -Fq 'claimName: opencrane-testv5-kurrentdb-backups' <<<"$backup_cronjob"
data_mount="$(grep -F -A2 'mountPath: /var/lib/kurrentdb' <<<"$backup_cronjob")"
grep -Fq 'readOnly: true' <<<"$data_mount"
backup_scripts="$(awk 'BEGIN { RS="---" } /kind: ConfigMap/ && /name: opencrane-testv5-kurrentdb-backup/ { print }' <<<"$rendered")"
[[ -n "$backup_scripts" ]]
grep -Fq 'backup.sh: |' <<<"$backup_scripts"
grep -Fq 'restore.sh: |' <<<"$backup_scripts"
grep -Fq "find index -type f -name '*.chk'" <<<"$backup_scripts"
grep -Fq "find . -maxdepth 1 -type f -name 'chunk-*'" <<<"$backup_scripts"
grep -Fq 'cp -p "$data/chaser.chk" "$data/truncate.chk"' <<<"$backup_scripts"
grep -Fq 'mv "$work" "$target"' <<<"$backup_scripts"
grep -Fq 'keep=7' <<<"$backup_scripts"
archive_claim="$(awk 'BEGIN { RS="---" } /kind: PersistentVolumeClaim/ && /name: opencrane-testv5-kurrentdb-backups/ { print }' <<<"$rendered")"
[[ -n "$archive_claim" ]]
grep -Fq 'helm.sh/resource-policy: keep' <<<"$archive_claim"
grep -Fq 'storage: "60Gi"' <<<"$archive_claim"
backup_policy="$(awk 'BEGIN { RS="---" } /kind: NetworkPolicy/ && /name: opencrane-testv5-kurrentdb-backup/ { print }' <<<"$rendered")"
[[ -n "$backup_policy" ]]
grep -Fq 'ingress: []' <<<"$backup_policy"
grep -Fq 'egress: []' <<<"$backup_policy"
if awk 'BEGIN { RS="---" } /kind: Role/ && /name: opencrane-testv5-kurrentdb-backup/ { found = 1 } END { exit !found }' <<<"$rendered"; then
  echo "fileCopy backups must not receive Kubernetes API permissions" >&2
  exit 1
fi

# volumeSnapshot mode: least-privilege Role, bounded API egress, and required snapshot inputs.
SNAPSHOT_VALUES=(
  --set historyStore.kurrentdb.backup.mode=volumeSnapshot
  --set historyStore.kurrentdb.backup.volumeSnapshot.className=csi-snapshots
  --set historyStore.kurrentdb.backup.volumeSnapshot.image.repository=registry.invalid/kubectl
  --set historyStore.kurrentdb.backup.volumeSnapshot.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  --set-string 'historyStore.kurrentdb.backup.volumeSnapshot.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'historyStore.kurrentdb.backup.volumeSnapshot.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
)
snapshot_rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" "${SNAPSHOT_VALUES[@]}" --show-only templates/app-rollups.yaml)"
grep -Fq 'opencrane.ai/kurrentdb-backup-mode: volumeSnapshot' <<<"$snapshot_rendered"
grep -Fq 'image: "registry.invalid/kubectl@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"' <<<"$snapshot_rendered"
grep -Fq 'volumeSnapshotClassName: csi-snapshots' <<<"$snapshot_rendered"
grep -Fq 'persistentVolumeClaimName: data-opencrane-testv5-kurrentdb-0' <<<"$snapshot_rendered"
grep -Fq 'apiGroups: ["snapshot.storage.k8s.io"]' <<<"$snapshot_rendered"
grep -Fq 'verbs: ["get", "list", "watch", "create", "delete"]' <<<"$snapshot_rendered"
grep -Fq 'kind: RoleBinding' <<<"$snapshot_rendered"
snapshot_policy="$(awk 'BEGIN { RS="---" } /kind: NetworkPolicy/ && /name: opencrane-testv5-kurrentdb-backup/ { print }' <<<"$snapshot_rendered")"
grep -Fq 'cidr: "10.43.0.1/32"' <<<"$snapshot_policy"
grep -Fq 'cidr: "172.18.0.2/32"' <<<"$snapshot_policy"
if grep -Fq 'name: opencrane-testv5-kurrentdb-backups' <<<"$snapshot_rendered"; then
  echo "volumeSnapshot mode must not create the file-copy archive claim" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" "${SNAPSHOT_VALUES[@]:0:2}" "${SNAPSHOT_VALUES[@]:4}" >/dev/null 2>&1; then
  echo "volumeSnapshot mode rendered without a digest-pinned kubectl image" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" "${SNAPSHOT_VALUES[@]:0:1}" "${SNAPSHOT_VALUES[@]:2}" >/dev/null 2>&1; then
  echo "volumeSnapshot mode rendered without a VolumeSnapshotClass" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" "${SNAPSHOT_VALUES[@]:0:5}" >/dev/null 2>&1; then
  echo "volumeSnapshot mode rendered without exact Kubernetes API endpoint CIDRs" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set historyStore.kurrentdb.backup.mode=rsync >/dev/null 2>&1; then
  echo "values schema accepted an unknown backup mode" >&2
  exit 1
fi
disabled_rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set historyStore.kurrentdb.backup.enabled=false --show-only templates/app-rollups.yaml)"
if grep -Fq 'kind: CronJob' <<<"$disabled_rendered"; then
  echo "backup.enabled=false still rendered the backup CronJob" >&2
  exit 1
fi

echo "KurrentDB Helm contract: PASS"
