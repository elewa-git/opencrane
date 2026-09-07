#!/usr/bin/env bash
# Proves the KurrentDB restore path refuses a serving ledger without confirmation, derives its Job
# from the rendered backup CronJob, swaps the volume in snapshot mode, and re-verifies bootstrap.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/kurrentdb-restore.sh"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
TEST_DIRECTORY="$(mktemp -d)"
trap 'cleanup_current_chart_sources; rm -rf "$TEST_DIRECTORY"' EXIT

# The deploy engine must source the helper, accept the flags, and run the restore before image
# resolution so a silo with a broken ledger never waits on registry access.
grep -Fq 'source "$SCRIPT_DIR/kurrentdb-restore.sh"' "$DEPLOY_CORE"
grep -Fq -- '--kurrentdb-restore)                 KURRENTDB_RESTORE_BACKUP_ID="$2"' "$DEPLOY_CORE"
grep -Fq -- '--kurrentdb-restore-confirm-serving) KURRENTDB_RESTORE_CONFIRM_SERVING="1"' "$DEPLOY_CORE"
grep -Fq -- '--kurrentdb-restore-list)            KURRENTDB_RESTORE_LIST="1"' "$DEPLOY_CORE"
grep -Fq 'run_kurrentdb_restore "$KURRENTDB_RESTORE_BACKUP_ID" "$KURRENTDB_RESTORE_CONFIRM_SERVING" || exit $?' "$DEPLOY_CORE"
grep -Fq '_load_kubernetes_api_helm_args historyStore.kurrentdb.backup.volumeSnapshot "KurrentDB backup"' "$DEPLOY_CORE"
grep -Fq '"${KURRENTDB_BACKUP_KUBERNETES_API_ARGS[@]}")' "$DEPLOY_CORE"
restore_line="$(grep -nF 'run_kurrentdb_restore "$KURRENTDB_RESTORE_BACKUP_ID"' "$DEPLOY_CORE" | cut -d: -f1)"
resolve_line="$(grep -nF '^_resolve_release_images$' "$DEPLOY_CORE" | cut -d: -f1 || true)"
resolve_line="${resolve_line:-$(grep -n '^_resolve_release_images$' "$DEPLOY_CORE" | cut -d: -f1)}"
bootstrap_wait_definition="$(grep -n '^wait_for_final_kurrentdb_bootstrap_job_if_present()$' "$DEPLOY_CORE" | cut -d: -f1)"
(( restore_line < resolve_line ))
(( bootstrap_wait_definition < restore_line ))

# Render the real backup CronJob once so the mocked kubectl hands the helper the chart's own template.
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"
helm template opencrane-testv5 "$CHART_DIR" \
  --set historyStore.kurrentdb.enabled=true \
  --set historyStore.kurrentdb.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set historyStore.kurrentdb.tls.existingSecret=kurrentdb-tls \
  --set historyStore.kurrentdb.bootstrapAdmin.existingSecret=kurrentdb-bootstrap-admin \
  --set historyStore.kurrentdb.bootstrapOps.existingSecret=kurrentdb-bootstrap-ops \
  --set historyStore.kurrentdb.serviceCredential.existingSecret=kurrentdb-history-service \
  --set historyStore.kurrentdb.bootstrap.image.repository=curlimages/curl \
  --set historyStore.kurrentdb.bootstrap.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --show-only templates/app-rollups.yaml \
  | awk 'BEGIN { RS="---" } /kind: CronJob/ && /name: opencrane-testv5-kurrentdb-backup/ { print }' >"$TEST_DIRECTORY/cronjob.yaml"
[[ -s "$TEST_DIRECTORY/cronjob.yaml" ]]
node -e '
  const yaml = require(process.argv[1]);
  const fs = require("node:fs");
  process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(process.argv[2], "utf8"))));
' "$ROOT_DIR/node_modules/js-yaml" "$TEST_DIRECTORY/cronjob.yaml" >"$TEST_DIRECTORY/cronjob.json"

RELEASE=opencrane-testv5
NAMESPACE=opencrane-testv5
TIMEOUT=60
CALLS=()
rm -f "$TEST_DIRECTORY"/created-*
MODE=fileCopy
READY_REPLICAS=1

log() { :; }
warn() { :; }
err() { printf '%s\n' "$*" >&2; }
wait_for_final_statefulset_if_present() { CALLS+=("wait-statefulset $1"); }
wait_for_final_kurrentdb_bootstrap_job_if_present() { CALLS+=("wait-bootstrap-job"); }
# helm and `kubectl annotate` run inside the helper's manifest pipeline, so they record their calls
# on disk rather than in CALLS.
helm()
{
  printf '%s\n' "$*" >"$TEST_DIRECTORY/helm-call"
  printf -- '---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: other\n---\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: %s-kurrentdb-bootstrap\n  labels:\n    app.kubernetes.io/instance: %s\n    app.kubernetes.io/component: kurrentdb-bootstrap\n---\n' "$RELEASE" "$RELEASE"
}
kubectl()
{
  CALLS+=("$*")
  local arguments="$*"
  local manifest_file=""
  local previous=""
  local argument
  for argument in "$@"; do
    [[ "$previous" == "-f" ]] && manifest_file="$argument"
    previous="$argument"
  done
  # The helper pipes into `kubectl create -f -`, so the mock runs in a subshell there; count the
  # created manifests on disk instead of in a shell variable.
  local created
  created="$(find "$TEST_DIRECTORY" -maxdepth 1 -name 'created-*' | wc -l | tr -d ' ')"
  created=$((created + 1))
  case "$arguments" in
    *"cronjob/${RELEASE}-kurrentdb-backup"*kurrentdb-backup-mode*) printf '%s' "$MODE" ;;
    *"cronjob/${RELEASE}-kurrentdb-backup"*activeDeadlineSeconds*) printf '3600' ;;
    *"cronjob/${RELEASE}-kurrentdb-backup"*"-o json"*) cat "$TEST_DIRECTORY/cronjob.json" ;;
    *"statefulset/${RELEASE}-kurrentdb"*readyReplicas*) printf '%s' "$READY_REPLICAS" ;;
    *"statefulset/${RELEASE}-kurrentdb"*".spec.replicas"*) printf '1' ;;
    *"annotate --local -f -"*)
      printf '%s\n' "$arguments" >"$TEST_DIRECTORY/annotate-call"
      node -e 'const yaml = require(process.argv[1]); const doc = yaml.load(require("node:fs").readFileSync(0, "utf8")); doc.metadata.annotations = {"meta.helm.sh/release-name": process.argv[2], "meta.helm.sh/release-namespace": process.argv[3]}; process.stdout.write(JSON.stringify(doc));' "$ROOT_DIR/node_modules/js-yaml" "$RELEASE" "$NAMESPACE"
      ;;
    *"create -f -"*) cat >"$TEST_DIRECTORY/created-$created" ;;
    *"create -f "*) cp "$manifest_file" "$TEST_DIRECTORY/created-$created" ;;
    *"get volumesnapshot -n"*readyToUse==true*) printf '%s-kurrentdb-20260901t020000z\n%s-kurrentdb-20260902t020000z\n' "$RELEASE" "$RELEASE" ;;
    *"volumesnapshot/"*readyToUse*) printf 'true' ;;
    *"volumesnapshot/"*volumeSnapshotClassName*) printf 'csi-snapshots' ;;
    *"pvc/data-${RELEASE}-kurrentdb-0"*storageClassName*) printf 'standard-rwo' ;;
    *"pvc/data-${RELEASE}-kurrentdb-0"*requests.storage*) printf '20Gi' ;;
    *"logs job/"*) printf 'mock logs\n' ;;
  esac
  return 0
}

# shellcheck source=../kurrentdb-restore.sh
source "$HELPER"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/kurrentdb-bootstrap.sh"

# 1. A serving ledger is never restored over without the explicit confirmation flag.
if run_kurrentdb_restore 20260901T020000Z 0 2>"$TEST_DIRECTORY/refused.error"; then
  echo 'restore proceeded against a serving KurrentDB without confirmation' >&2
  exit 1
fi
grep -Fq 'serving traffic' "$TEST_DIRECTORY/refused.error"
grep -Fq -- '--kurrentdb-restore-confirm-serving' "$TEST_DIRECTORY/refused.error"
if printf '%s\n' "${CALLS[@]}" | grep -q 'scale statefulset'; then
  echo 'refused restore still scaled the StatefulSet' >&2
  exit 1
fi

# 2. fileCopy mode: the restore Job is the CronJob template with a writable data mount and no affinity.
CALLS=()
rm -f "$TEST_DIRECTORY"/created-*
run_kurrentdb_restore 20260901T020000Z 1 >/dev/null
job="$TEST_DIRECTORY/created-1"
[[ "$(jq -r '.kind' "$job")" == "Job" ]]
[[ "$(jq -r '.metadata.name' "$job")" == "${RELEASE}-kurrentdb-restore-"* ]]
[[ "$(jq -r '.metadata.namespace' "$job")" == "$NAMESPACE" ]]
[[ "$(jq -r '.metadata.labels["opencrane.ai/kurrentdb-restore"]' "$job")" == "restore" ]]
[[ "$(jq -r '.spec.backoffLimit' "$job")" == "0" ]]
[[ "$(jq -r '.spec.template.spec.affinity // "absent"' "$job")" == "absent" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].image' "$job")" == "curlimages/curl@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].command[2]' "$job")" == "exec /bin/sh /opt/opencrane/kurrentdb-backup/restore.sh" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].env[] | select(.name == "OPENCRANE_RESTORE_BACKUP_ID") | .value' "$job")" == "20260901T020000Z" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].volumeMounts[] | select(.name == "data") | .readOnly' "$job")" == "false" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].volumeMounts[] | select(.name == "archive") | .mountPath' "$job")" == "/var/lib/opencrane/kurrentdb-backups" ]]
[[ "$(jq -r '.spec.template.spec.securityContext.runAsUser' "$job")" == "1001" ]]
[[ "$(jq -r '.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem' "$job")" == "true" ]]
calls="$(printf '%s\n' "${CALLS[@]}")"
scale_down="$(grep -nF "scale statefulset/${RELEASE}-kurrentdb -n $NAMESPACE --replicas=0" <<<"$calls" | cut -d: -f1)"
pod_gone="$(grep -nF "wait --for=delete pod/${RELEASE}-kurrentdb-0" <<<"$calls" | cut -d: -f1)"
# `kubectl create -f -` runs inside the helper's pipeline, so only its on-disk manifest is visible
# here; the completion wait that follows it fixes its place in the order.
job_complete="$(grep -n "wait --for=condition=complete job/${RELEASE}-kurrentdb-restore-" <<<"$calls" | cut -d: -f1)"
scale_up="$(grep -nF "scale statefulset/${RELEASE}-kurrentdb -n $NAMESPACE --replicas=1" <<<"$calls" | cut -d: -f1)"
statefulset_wait="$(grep -nF "wait-statefulset ${RELEASE}-kurrentdb" <<<"$calls" | cut -d: -f1)"
bootstrap_deleted="$(grep -n "^delete -f .* --ignore-not-found" <<<"$calls" | cut -d: -f1)"
bootstrap_created="$(grep -n "^create -f /" <<<"$calls" | cut -d: -f1)"
bootstrap_wait="$(grep -nF 'wait-bootstrap-job' <<<"$calls" | cut -d: -f1)"
(( scale_down < pod_gone && pod_gone < job_complete && job_complete < scale_up ))
(( scale_up < statefulset_wait && statefulset_wait < bootstrap_deleted && bootstrap_deleted < bootstrap_created && bootstrap_created < bootstrap_wait ))
grep -Fq "get manifest $RELEASE -n $NAMESPACE" "$TEST_DIRECTORY/helm-call"
grep -Fq "meta.helm.sh/release-name=$RELEASE" "$TEST_DIRECTORY/annotate-call"
grep -Fq "meta.helm.sh/release-namespace=$NAMESPACE" "$TEST_DIRECTORY/annotate-call"
bootstrap_job="$TEST_DIRECTORY/created-2"
[[ "$(jq -r '.metadata.name' "$bootstrap_job")" == "${RELEASE}-kurrentdb-bootstrap" ]]
[[ "$(jq -r '.metadata.namespace' "$bootstrap_job")" == "$NAMESPACE" ]]

# 3. Listing never touches the ReadWriteOnce data volume the running database holds.
CALLS=()
rm -f "$TEST_DIRECTORY"/created-*
list_kurrentdb_backups >/dev/null
listing="$TEST_DIRECTORY/created-1"
[[ "$(jq -r '.metadata.labels["opencrane.ai/kurrentdb-restore"]' "$listing")" == "list" ]]
[[ "$(jq -r '[.spec.template.spec.volumes[] | select(.name == "data")] | length' "$listing")" == "0" ]]
[[ "$(jq -r '[.spec.template.spec.containers[0].volumeMounts[] | select(.name == "data")] | length' "$listing")" == "0" ]]
grep -Fq 'manifest.json' <<<"$(jq -r '.spec.template.spec.containers[0].command[2]' "$listing")"

# 4. volumeSnapshot mode: safety snapshot first, then the data claim is recreated from the chosen snapshot.
MODE=volumeSnapshot
READY_REPLICAS=0
CALLS=()
rm -f "$TEST_DIRECTORY"/created-*
run_kurrentdb_restore latest 0 >/dev/null
safety="$TEST_DIRECTORY/created-1"
claim="$TEST_DIRECTORY/created-2"
grep -Fq 'kind: VolumeSnapshot' "$safety"
grep -Fq "name: ${RELEASE}-kurrentdb-prerestore-" "$safety"
node - "$ROOT_DIR/node_modules/js-yaml" "$safety" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const yaml = require(process.argv[2]);
const name = yaml.load(fs.readFileSync(process.argv[3], "utf8")).metadata.name;
assert.ok(name.length <= 253);
assert.match(name, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/);
NODE
grep -Fq 'opencrane.ai/kurrentdb-backup-kind: pre-restore' "$safety"
grep -Fq 'volumeSnapshotClassName: csi-snapshots' "$safety"
grep -Fq "persistentVolumeClaimName: data-${RELEASE}-kurrentdb-0" "$safety"
grep -Fq 'kind: PersistentVolumeClaim' "$claim"
grep -Fq "name: data-${RELEASE}-kurrentdb-0" "$claim"
grep -Fq 'storageClassName: standard-rwo' "$claim"
grep -Fq 'storage: 20Gi' "$claim"
grep -Fq "name: ${RELEASE}-kurrentdb-20260902t020000z" "$claim"
grep -Fq 'kind: VolumeSnapshot' "$claim"
[[ "$(jq -r '.metadata.name' "$TEST_DIRECTORY/created-3")" == "${RELEASE}-kurrentdb-bootstrap" ]]
calls="$(printf '%s\n' "${CALLS[@]}")"
safety_wait="$(grep -nF "volumesnapshot/${RELEASE}-kurrentdb-prerestore-" <<<"$calls" | grep -F 'wait --for=' | cut -d: -f1 | head -n 1)"
claim_deleted="$(grep -nF "delete pvc/data-${RELEASE}-kurrentdb-0" <<<"$calls" | cut -d: -f1)"
scale_down="$(grep -nF -- '--replicas=0' <<<"$calls" | cut -d: -f1)"
(( scale_down < safety_wait && safety_wait < claim_deleted ))
if printf '%s\n' "${CALLS[@]}" | grep -q 'kurrentdb-restore-'; then
  echo 'snapshot restore must not create a file-copy restore Job' >&2
  exit 1
fi

echo "KurrentDB restore contract: PASS"
