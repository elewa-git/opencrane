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

rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}")"
printf '%s\n' "$rendered" | node -e '
  const yaml = require(process.argv[1]);
  const fs = require("node:fs");
  const assert = require("node:assert/strict");
  const resources = yaml.loadAll(fs.readFileSync(0, "utf8"));
  for (const kind of ["ServiceAccount", "Service", "StatefulSet"]) {
    if (!resources.some(function _OwnsKurrentResource(resource) {
      return resource?.kind === kind && resource.metadata?.name === "opencrane-testv5-kurrentdb";
    })) throw new Error(`The KurrentDB render is missing its ${kind}`);
  }
  const pod = resources.find(function _IsKurrentStatefulSet(resource) {
    return resource?.kind === "StatefulSet" && resource.metadata?.name === "opencrane-testv5-kurrentdb";
  }).spec.template.spec;
  const container = pod.containers.find(function _IsKurrentContainer(candidate) {
    return candidate.name === "kurrentdb";
  });
  const environment = Object.fromEntries(container.env.map(function _ReadEnvironment(entry) {
    return [entry.name, entry.value];
  }));
  // Bootstrap installs stream ACLs through the authenticated HTTP stream API.
  assert.equal(environment.KURRENTDB_ENABLE_ATOM_PUB_OVER_HTTP, "true");
  for (const variable of ["KURRENTDB_INSECURE", "KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS",
    "KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS", "KURRENTDB_ENABLE_TRUSTED_AUTH"]) {
    assert.equal(environment[variable], "false");
  }
  const rootMount = container.volumeMounts.find(function _ContainsTrustedRoots(mount) {
    return mount.mountPath === environment.KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH;
  });
  assert.ok(rootMount, "KurrentDB must mount its trusted-root directory");
  assert.equal(rootMount.readOnly, true);
  const rootSecret = pod.volumes.find(function _SuppliesTrustedRoots(volume) {
    return volume.name === rootMount.name;
  }).secret;
  // KurrentDB rejects a server certificate when its trusted-root loader encounters it.
  assert.equal(rootSecret.secretName, "kurrentdb-tls");
  assert.deepEqual(rootSecret.items, [{ key: "ca.crt", path: "ca.crt" }]);
  for (const [variable, key] of [
    ["KURRENTDB_CERTIFICATE_FILE", "tls.crt"],
    ["KURRENTDB_CERTIFICATE_PRIVATE_KEY_FILE", "tls.key"],
  ]) {
    const mount = container.volumeMounts.find(function _ContainsNodeCertificate(candidate) {
      return environment[variable] === `${candidate.mountPath}/${key}`;
    });
    assert.ok(mount, `KurrentDB must mount ${key}`);
    assert.notEqual(mount.name, rootMount.name, "Node credentials must stay outside the trusted roots");
    assert.equal(mount.readOnly, true);
    const secret = pod.volumes.find(function _SuppliesNodeCertificate(volume) {
      return volume.name === mount.name;
    }).secret;
    assert.equal(secret.secretName, "kurrentdb-tls");
    assert.ok(secret.items.some(function _ProjectsNodeCredential(item) {
      return item.key === key && item.path === key;
    }));
  }
  const bootstrap = resources.find(function _IsKurrentBootstrapScript(resource) {
    return resource?.kind === "ConfigMap" && resource.metadata?.name === "opencrane-testv5-kurrentdb-bootstrap";
  }).data["bootstrap.sh"];
  assert.ok(bootstrap.includes("$endpoint/streams/%24settings/head"), "Bootstrap must read the current ACL event");
  assert.ok(bootstrap.includes("Accept: application/json"), "Bootstrap must request the event data as JSON");
  const quote = String.fromCharCode(39);
  assert.ok(bootstrap.includes(`--user "$history_username:$history_password" --header ${quote}Accept: application/json${quote}`),
    "The service probe must request a supported stream representation");
  assert.ok(bootstrap.includes(`"$subscription_url/info"`), "Bootstrap must inspect a subscription without consuming messages");
  assert.equal(/^\s*subscription_status=.*"\$subscription_url"/m.test(bootstrap), false);
  const queryStart = bootstrap.indexOf(`! jq -e ${quote}`) + `! jq -e ${quote}`.length;
  const queryEnd = bootstrap.indexOf(quote, queryStart);
  assert.ok(queryStart >= `! jq -e ${quote}`.length && queryEnd > queryStart);
  const aclQuery = bootstrap.slice(queryStart, queryEnd);
  const { spawnSync } = require("node:child_process");
  function _AcceptsCurrentAcl(document) {
    const result = spawnSync("jq", ["-e", aclQuery], { input: JSON.stringify(document), encoding: "utf8" });
    if (result.error) throw result.error;
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return result.status === 0;
  }
  const adminAcl = { $r: "$admins", $w: "$admins", $d: "$admins", $mr: "$admins", $mw: "$admins" };
  const expected = {
    $userStreamAcl: { ...adminAcl, $r: ["$admins", "opencrane-history"], $w: ["$admins", "opencrane-history"] },
    $systemStreamAcl: adminAcl,
  };
  assert.equal(_AcceptsCurrentAcl(expected), true);
  const widened = { ...expected, $userStreamAcl: { ...expected.$userStreamAcl, $r: "$all" } };
  assert.equal(_AcceptsCurrentAcl(widened), false);
  assert.equal(_AcceptsCurrentAcl({ ...widened, previous: expected }), false,
    "A historical matching ACL must not conceal different current permissions");
  assert.equal(_AcceptsCurrentAcl({ entries: [{ data: JSON.stringify(expected) }] }), false,
    "An HTTP feed is not the current settings event");
  assert.equal(_AcceptsCurrentAcl({}), false);
' "$ROOT_DIR/node_modules/js-yaml"
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
snapshot_rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" "${SNAPSHOT_VALUES[@]}")"
# Execute the rendered backup script with a local API stub to validate the actual snapshot name.
printf '%s\n' "$snapshot_rendered" | node -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");
  const yaml = require(process.argv[1]);
  const resources = yaml.loadAll(fs.readFileSync(0, "utf8"));
  const script = resources.find(function _IsBackupConfiguration(resource) {
    return resource?.kind === "ConfigMap" && resource.metadata.name === "opencrane-testv5-kurrentdb-backup";
  }).data["backup.sh"];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kurrentdb-snapshot-name-"));
  try {
    const manifest = path.join(directory, "snapshot.yaml");
    fs.writeFileSync(path.join(directory, "kubectl"), `#!/bin/sh\nset -eu\ncase "$1" in\n  create) cat > "$SNAPSHOT_MANIFEST" ;;\n  wait|get) ;;\n  *) exit 1 ;;\nesac\n`, { mode: 0o700 });
    execFileSync("/bin/sh", ["-c", script.replaceAll("/tmp/snapshots", path.join(directory, "snapshots"))], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SNAPSHOT_MANIFEST: manifest }
    });
    const snapshot = yaml.load(fs.readFileSync(manifest, "utf8"));
    assert.equal(snapshot.kind, "VolumeSnapshot");
    assert.ok(snapshot.metadata.name.length <= 253);
    assert.match(snapshot.metadata.name, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/);
    assert.equal(snapshot.spec.source.persistentVolumeClaimName, "data-opencrane-testv5-kurrentdb-0");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
' "$ROOT_DIR/node_modules/js-yaml"
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
disabled_rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set historyStore.kurrentdb.backup.enabled=false)"
if grep -Fq 'kind: CronJob' <<<"$disabled_rendered"; then
  echo "backup.enabled=false still rendered the backup CronJob" >&2
  exit 1
fi

echo "KurrentDB Helm contract: PASS"
