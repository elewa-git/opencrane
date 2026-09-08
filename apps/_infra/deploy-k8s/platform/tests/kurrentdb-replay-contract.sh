#!/usr/bin/env bash
# Exercises replay through the rendered bootstrap boundary without a Kubernetes write.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
REAL_KUBECTL="$(command -v kubectl)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap 'cleanup_current_chart_sources; rm -rf "$TEST_DIRECTORY"' EXIT
prepare_current_chart_sources
RELEASE=opencrane-testv5
NAMESPACE=opencrane-testv5
CLUSTER_TENANT=testv5
TIMEOUT=20
CONFIG_MUTATION='.'
MANIFEST_MUTATION='.'
STATEFULSET_MUTATION='.'
JOB_CONDITION=Complete
JOB_READ_FAILURE=0
CREATE_FAILURE=0
log() { :; }
err() { printf '%s\n' "$*" >&2; }
helm template "$RELEASE" "$(current_chart_sources_dir)" --namespace "$NAMESPACE" \
  --set clustertenantManager.firstUser.clusterTenant=testv5 \
  --set clustertenantManager.firstUser.email=owner@example.invalid \
  --set historyStore.kurrentdb.enabled=true \
  --set historyStore.kurrentdb.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set historyStore.kurrentdb.tls.existingSecret=kurrentdb-tls \
  --set historyStore.kurrentdb.bootstrapAdmin.existingSecret=kurrentdb-bootstrap-admin \
  --set historyStore.kurrentdb.bootstrapOps.existingSecret=kurrentdb-bootstrap-ops \
  --set historyStore.kurrentdb.serviceCredential.existingSecret=kurrentdb-history-service \
  --set historyStore.kurrentdb.bootstrap.image.repository=example.test/bootstrap \
  --set historyStore.kurrentdb.bootstrap.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  >"$TEST_DIRECTORY/release.yaml"
node - "$ROOT_DIR/node_modules/js-yaml" "$TEST_DIRECTORY" "$RELEASE" "$NAMESPACE" <<'JS'
const fs = require('node:fs');
const yaml = require(process.argv[2]);
const [directory, release, namespace] = process.argv.slice(3);
const resources = yaml.loadAll(fs.readFileSync(directory + '/release.yaml', 'utf8'));
for (const [kind, suffix, file] of [['Job','-kurrentdb-bootstrap','job'], ['ConfigMap','-kurrentdb-bootstrap','config'], ['StatefulSet','-kurrentdb','statefulset']]) {
  const resource = resources.find(item => item?.kind === kind && item.metadata.name === release + suffix);
  if (!resource) throw new Error('Missing rendered ' + kind);
  resource.metadata.namespace = namespace;
  resource.metadata.annotations = {'meta.helm.sh/release-name':release,'meta.helm.sh/release-namespace':namespace};
  resource.metadata.uid = 'recorded-uid';
  resource.metadata.resourceVersion = '7';
  resource.status = kind === 'Job' ? {conditions:[{type:'Complete',status:'True'}]} : {readyReplicas:1};
  fs.writeFileSync(directory + '/' + file + '.json', JSON.stringify(resource));
}
JS
helm()
{
  [[ "$*" == "get manifest $RELEASE -n $NAMESPACE" ]] || return 9
  cat "$TEST_DIRECTORY/release.yaml"
}
kubectl()
{
  printf '%s\n' "$*" >>"$TEST_DIRECTORY/calls"
  case "$1:$2" in
    annotate:--local) "$REAL_KUBECTL" "$@" | jq "$MANIFEST_MUTATION" ;;
    get:statefulset/*) jq "$STATEFULSET_MUTATION" "$TEST_DIRECTORY/statefulset.json" ;;
    get:configmap/*) jq "$CONFIG_MUTATION" "$TEST_DIRECTORY/config.json" ;;
    create:-f)
      (( CREATE_FAILURE == 0 )) || return 7
      cp "$3" "$TEST_DIRECTORY/created.json"
      printf 'kurrentdb-activation-replay-test123'
      ;;
    get:job/*)
      (( JOB_READ_FAILURE == 0 )) || return 7
      jq -n --arg condition "$JOB_CONDITION" '{apiVersion:"batch/v1",kind:"Job",status:{conditions:[{type:$condition,status:"True"}]}}'
      ;;
    logs:*) printf 'Parked conversation-computer activations were submitted for replay.\n' ;;
    *) printf 'Unexpected Kubernetes call: %s\n' "$*" >&2; return 9 ;;
  esac
}
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/kurrentdb-bootstrap.sh"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/kurrentdb-replay.sh"
run_kurrentdb_replay_parked
node - "$TEST_DIRECTORY" <<'JS'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const dir = process.argv[2];
const job = JSON.parse(fs.readFileSync(dir + '/created.json'));
const bootstrap = JSON.parse(fs.readFileSync(dir + '/job.json'));
const config = JSON.parse(fs.readFileSync(dir + '/config.json'));
const pod = job.spec.template.spec;
assert.equal(job.metadata.namespace, 'opencrane-testv5');
assert.equal(job.metadata.generateName, 'kurrentdb-activation-replay-');
assert.equal(job.metadata.uid, undefined);
assert.equal(job.spec.selector, undefined);
assert.equal(job.status, undefined);
assert.equal(job.spec.backoffLimit, 0);
assert.equal(job.spec.activeDeadlineSeconds, 20);
assert.equal(job.spec.ttlSecondsAfterFinished, 3600);
assert.equal(pod.automountServiceAccountToken, false);
assert.deepEqual(pod.securityContext, bootstrap.spec.template.spec.securityContext);
assert.equal(pod.containers[0].image, bootstrap.spec.template.spec.containers[0].image);
assert.deepEqual(pod.containers[0].command, ['/bin/sh','-c',config.data['replay.sh']]);
assert.deepEqual(JSON.parse(pod.containers[0].env[0].value), {endpoint:'https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113',streamName:'computer-activations-testv5'});
assert.deepEqual(pod.containers[0].env[1], {name:'OPENCRANE_KURRENTDB_REPLAY_TIMEOUT_SECONDS',value:String(job.spec.activeDeadlineSeconds)});
assert.equal(pod.volumes.some(v => ['kurrentdb-service','bootstrap-script'].includes(v.name)), false);
assert.equal(pod.containers[0].volumeMounts.some(v => ['kurrentdb-service','bootstrap-script'].includes(v.name)), false);
assert.deepEqual(pod.volumes.find(v => v.name === 'kurrentdb-tls').secret.items, [{key:'ca.crt',path:'ca.crt'}]);
assert.equal(pod.volumes.find(v => v.name === 'kurrentdb-bootstrap-admin').secret.secretName, 'kurrentdb-bootstrap-admin');
assert.equal(job.spec.template.metadata.labels['app.kubernetes.io/component'], 'kurrentdb-bootstrap');
assert.deepEqual(job.spec.template.metadata.labels, bootstrap.spec.template.metadata.labels,
  'The derived Pod must retain the bootstrap NetworkPolicy selectors');
assert.ok(!fs.readFileSync(dir + '/calls','utf8').match(/delete |patch |apply /));
assert.ok(fs.readFileSync(dir + '/calls','utf8').includes('get job/kurrentdb-activation-replay-test123'));
JS
expect_no_creation()
{
  rm -f "$TEST_DIRECTORY/created.json"
  if run_kurrentdb_replay_parked >"$TEST_DIRECTORY/error" 2>&1; then
    echo 'Invalid replay boundary was accepted.' >&2; exit 1
  fi
  [[ ! -e "$TEST_DIRECTORY/created.json" ]] || { echo 'Invalid replay created a Job.' >&2; exit 1; }
}
for CONFIG_MUTATION in \
  '.metadata.annotations["meta.helm.sh/release-name"]="foreign"' \
  '.metadata.labels["app.kubernetes.io/component"]="foreign"' \
  '.metadata.deletionTimestamp="2026-09-08T00:00:00Z"' \
  'del(.data["replay.sh"])' \
  '.data["replay.sh"]="echo changed"' \
  '.data["replay-target.json"]="{\"endpoint\":\"https://foreign:2113\",\"streamName\":\"computer-activations-testv5\"}"' \
  '.data["replay-target.json"]="{\"endpoint\":\"https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113@foreign:443\",\"streamName\":\"computer-activations-testv5\"}"' \
  '.data["replay-target.json"]="{\"endpoint\":\"https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113\",\"streamName\":\"computer-activations-foreign\"}"'; do
  expect_no_creation
done
CONFIG_MUTATION='.'
MANIFEST_MUTATION='if .kind == "ConfigMap" then del(.data["replay.sh"]) else . end'
expect_no_creation
MANIFEST_MUTATION='if .kind == "Job" then .metadata.annotations["meta.helm.sh/release-name"]="foreign" else . end'
expect_no_creation
MANIFEST_MUTATION='.'
STATEFULSET_MUTATION='.status.readyReplicas=0'
expect_no_creation
STATEFULSET_MUTATION='.'
CREATE_FAILURE=1
expect_no_creation
CREATE_FAILURE=0
sleep() { printf '%s\n' "$1" >>"$TEST_DIRECTORY/sleeps"; SECONDS=$((SECONDS + $1)); }
for JOB_CONDITION in Failed FailureTarget; do
  if run_kurrentdb_replay_parked >/dev/null 2>&1; then echo 'Failed replay Job was reported successful.' >&2; exit 1; fi
  [[ ! -e "$TEST_DIRECTORY/sleeps" ]] || { echo 'Terminal replay Job consumed another wait.' >&2; exit 1; }
done
JOB_READ_FAILURE=1
if run_kurrentdb_replay_parked >/dev/null 2>&1; then echo 'Unreadable replay Job was reported successful.' >&2; exit 1; fi
JOB_READ_FAILURE=0
JOB_CONDITION=Running
TIMEOUT=3
if run_kurrentdb_replay_parked >/dev/null 2>&1; then echo 'Running replay Job ignored its deadline.' >&2; exit 1; fi
[[ "$(cat "$TEST_DIRECTORY/sleeps")" == $'2\n1' ]] || { echo 'Replay wait exceeded its remaining budget.' >&2; exit 1; }
for conflicting in --preflight --kurrentdb-bootstrap-retry --kurrentdb-bootstrap-prepare-update --kurrentdb-restore-list --kurrentdb-restore-confirm-serving; do
  if OPENCRANE_CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s" bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh" \
    --kurrentdb-replay-parked "$conflicting" >"$TEST_DIRECTORY/conflict" 2>&1; then
    echo "Replay accepted conflicting action $conflicting." >&2; exit 1
  fi
  grep -Fq 'cannot be combined with bootstrap, restore or preflight' "$TEST_DIRECTORY/conflict"
done
bash "$ROOT_DIR/apps/_infra/kurrentdb/tests/replay-script-contract.sh"
echo 'KurrentDB operator replay boundary contract: PASS'
