#!/usr/bin/env bash
# Bootstrap maintenance checks ownership and Job state before changing verification metadata.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap 'cleanup_current_chart_sources; rm -rf "$TEST_DIRECTORY"' EXIT
RELEASE=opencrane-testv5
NAMESPACE=opencrane-testv5
TIMEOUT=20
MODE=failed
READY=1
MANIFEST_MODE=valid
STATEFULSET_MUTATION='.'
JOB_MUTATION='.'
DELETE_FAILURE=0
WAIT_FAILURE=0
log() { :; }
err() { printf '%s\n' "$*" >&2; }
wait_for_final_kurrentdb_bootstrap_job_if_present() { printf 'verified\n' >>"$TEST_DIRECTORY/calls"; }

# Start from the chart's actual labels; Helm supplies ownership annotations on live resources.
prepare_current_chart_sources
render_bootstrap_release()
{
  helm template "$RELEASE" "$(current_chart_sources_dir)" --namespace "$NAMESPACE" \
  --set historyStore.kurrentdb.enabled=true \
  --set historyStore.kurrentdb.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set historyStore.kurrentdb.tls.existingSecret=kurrentdb-tls \
  --set historyStore.kurrentdb.bootstrapAdmin.existingSecret=kurrentdb-bootstrap-admin \
  --set historyStore.kurrentdb.bootstrapOps.existingSecret=kurrentdb-bootstrap-ops \
  --set historyStore.kurrentdb.serviceCredential.existingSecret=kurrentdb-history-service \
  --set historyStore.kurrentdb.bootstrap.image.repository=example.test/bootstrap \
  --set "historyStore.kurrentdb.bootstrap.image.digest=$1" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  >"$2"
}
render_bootstrap_release sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$TEST_DIRECTORY/release.yaml"
render_bootstrap_release sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc "$TEST_DIRECTORY/desired-release.yaml"
node -e '
  const yaml = require(process.argv[1]);
  const fs = require("node:fs");
  const [directory, release, namespace] = process.argv.slice(2);
  const resources = yaml.loadAll(fs.readFileSync(directory + "/release.yaml", "utf8"));
  for (const [kind, suffix, file] of [["Job", "-kurrentdb-bootstrap", "job"], ["StatefulSet", "-kurrentdb", "statefulset"]]) {
    const resource = resources.find(item => item?.kind === kind && item.metadata.name === release + suffix);
    if (!resource) throw new Error("The chart did not emit " + kind);
    resource.metadata.namespace = namespace;
    resource.metadata.annotations = {"meta.helm.sh/release-name": release, "meta.helm.sh/release-namespace": namespace};
    resource.metadata.uid = "9492044c-5dbf-4b0c-b34d-92aee30820c1";
    resource.metadata.resourceVersion = "12345";
    resource.status = kind === "Job" ? {conditions: [{type: "Failed", status: "True"}]} : {readyReplicas: 1};
    fs.writeFileSync(directory + "/" + file + ".json", JSON.stringify(resource));
  }
  const desired = yaml.loadAll(fs.readFileSync(directory + "/desired-release.yaml", "utf8"))
    .find(item => item?.kind === "Job" && item.metadata.name === release + "-kurrentdb-bootstrap");
  if (!desired) throw new Error("The desired chart omitted bootstrap");
  fs.writeFileSync(directory + "/desired-job.json", JSON.stringify(desired));
' "$ROOT_DIR/node_modules/js-yaml" "$TEST_DIRECTORY" "$RELEASE" "$NAMESPACE"

helm()
{
  if [[ "$1" == upgrade ]]; then
    [[ "$2" == --install && "$3" == "$RELEASE" && -f "$TEST_DIRECTORY/job-absent" ]] || return 9
    cp "$TEST_DIRECTORY/desired-job.json" "$TEST_DIRECTORY/created.json"
    printf 'helm-created\n' >>"$TEST_DIRECTORY/mutations"
    return 0
  fi
  [[ "$*" == "get manifest $RELEASE -n $NAMESPACE" ]] || return 9
  case "$MANIFEST_MODE" in
    valid) cat "$TEST_DIRECTORY/release.yaml" ;;
    foreign) sed 's/app.kubernetes.io\/instance: .*/app.kubernetes.io\/instance: foreign/' "$TEST_DIRECTORY/release.yaml" ;;
    missing) printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: unrelated\n' ;;
    error) return 9 ;;
  esac
}

kubectl()
{
  printf '%s\n' "$*" >>"$TEST_DIRECTORY/calls"
  case "$1:$2" in
    get:job/*)
      local count
      count="$(cat "$TEST_DIRECTORY/job-reads")"
      printf '%s\n' "$((count + 1))" >"$TEST_DIRECTORY/job-reads"
      case "$MODE" in
        error) return 7 ;;
        malformed) printf '{' ;;
        missing) return 0 ;;
        active) jq '.status = {active: 1}' "$TEST_DIRECTORY/job.json" ;;
        complete|uid-race|version-race) jq ".status.conditions[0].type = \"Complete\" | $JOB_MUTATION" "$TEST_DIRECTORY/job.json" ;;
        foreign) jq '.metadata.annotations["meta.helm.sh/release-name"] = "foreign"' "$TEST_DIRECTORY/job.json" ;;
        foreign-instance) jq '.spec.template.metadata.labels["app.kubernetes.io/instance"] = "foreign"' "$TEST_DIRECTORY/job.json" ;;
        missing-instance) jq 'del(.spec.template.metadata.labels["app.kubernetes.io/instance"])' "$TEST_DIRECTORY/job.json" ;;
        deleting) jq '.metadata.deletionTimestamp = "2026-09-07T19:00:00Z"' "$TEST_DIRECTORY/job.json" ;;
        race)
          if (( count > 0 )); then jq '.status = {active: 1}' "$TEST_DIRECTORY/job.json";
          else cat "$TEST_DIRECTORY/job.json"; fi
          ;;
        *) cat "$TEST_DIRECTORY/job.json" ;;
      esac
      ;;
    get:statefulset/*)
      if [[ "$READY" == error ]]; then return 7; fi
      jq --argjson ready "$READY" "$STATEFULSET_MUTATION | .status.readyReplicas = \$ready" "$TEST_DIRECTORY/statefulset.json"
      ;;
    annotate:--local)
      node -e 'const yaml = require(process.argv[1]); const doc = yaml.load(require("node:fs").readFileSync(0, "utf8")); if (!doc) process.exit(1); doc.metadata.annotations = {"meta.helm.sh/release-name": process.argv[2], "meta.helm.sh/release-namespace": process.argv[3]}; process.stdout.write(JSON.stringify(doc));' "$ROOT_DIR/node_modules/js-yaml" "$RELEASE" "$NAMESPACE"
      ;;
    delete:-f) printf 'deleted\n' >>"$TEST_DIRECTORY/mutations" ;;
    delete:--raw)
      [[ "$3" == "/apis/batch/v1/namespaces/$NAMESPACE/jobs/$RELEASE-kurrentdb-bootstrap" && "$4" == -f ]] || return 9
      cp "$5" "$TEST_DIRECTORY/delete-options.json"
      local observed_uid observed_version
      observed_uid="$(jq -r '.metadata.uid' "$TEST_DIRECTORY/job.json")"
      observed_version="$(jq -r '.metadata.resourceVersion' "$TEST_DIRECTORY/job.json")"
      if [[ "$MODE" == uid-race ]]; then observed_uid=replacement-uid; fi
      if [[ "$MODE" == version-race ]]; then observed_version=12346; fi
      jq -e --arg uid "$observed_uid" --arg version "$observed_version" '
        .apiVersion == "v1" and .kind == "DeleteOptions" and .propagationPolicy == "Foreground"
        and .preconditions == {uid: $uid, resourceVersion: $version}
      ' "$5" >/dev/null || return 8
      if (( DELETE_FAILURE != 0 )); then return "$DELETE_FAILURE"; fi
      printf 'prepared\n' >>"$TEST_DIRECTORY/mutations"
      touch "$TEST_DIRECTORY/job-absent"
      ;;
    wait:--for=delete)
      [[ "$3" == "job/$RELEASE-kurrentdb-bootstrap" && "$*" == *"--timeout=${TIMEOUT}s"* ]] || return 9
      return "$WAIT_FAILURE"
      ;;
    create:-f) cp "$3" "$TEST_DIRECTORY/created.json"; printf 'created\n' >>"$TEST_DIRECTORY/mutations" ;;
    *) return 9 ;;
  esac
}

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/kurrentdb-bootstrap.sh"
reset_case()
{
  : >"$TEST_DIRECTORY/calls"
  : >"$TEST_DIRECTORY/mutations"
  printf '0\n' >"$TEST_DIRECTORY/job-reads"
  rm -f "$TEST_DIRECTORY/job-absent" "$TEST_DIRECTORY/delete-options.json"
}
for MODE in failed missing; do
  reset_case
  run_kurrentdb_bootstrap_retry
  [[ "$(cat "$TEST_DIRECTORY/mutations")" == $'deleted\ncreated' ]]
  [[ "$(tail -1 "$TEST_DIRECTORY/calls")" == verified ]]
  jq -e --arg release "$RELEASE" --arg namespace "$NAMESPACE" '.kind == "Job" and .metadata.name == ($release + "-kurrentdb-bootstrap") and .metadata.namespace == $namespace and .metadata.annotations["meta.helm.sh/release-name"] == $release and .spec.template.spec.containers[0].name == "bootstrap"' "$TEST_DIRECTORY/created.json" >/dev/null
  if grep -Eq '^(scale|patch)| pvc| secret' "$TEST_DIRECTORY/calls"; then
    echo 'Bootstrap retry changed a ledger workload or credential.' >&2; exit 1
  fi
done
for MODE in active complete foreign foreign-instance missing-instance deleting error race; do
  reset_case
  if run_kurrentdb_bootstrap_retry >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap retry accepted forbidden case $MODE." >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]]
done
MODE=failed
READY=0
reset_case
if run_kurrentdb_bootstrap_retry >"$TEST_DIRECTORY/result" 2>&1; then
  echo 'Bootstrap retry accepted an unready ledger.' >&2; exit 1
fi
[[ ! -s "$TEST_DIRECTORY/mutations" ]]
READY=1
for STATEFULSET_MUTATION in \
  '.apiVersion = "foreign/v1"' \
  '.kind = "Deployment"' \
  '.metadata.name = "foreign-kurrentdb"' \
  '.metadata.namespace = "foreign"' \
  '.metadata.annotations["meta.helm.sh/release-name"] = "foreign"' \
  '.metadata.annotations["meta.helm.sh/release-namespace"] = "foreign"' \
  '.metadata.labels["app.kubernetes.io/component"] = "foreign"' \
  '.spec.template.metadata.labels["app.kubernetes.io/instance"] = "foreign"' \
  'del(.spec.template.metadata.labels["app.kubernetes.io/instance"])' \
  '.metadata.deletionTimestamp = "2026-09-07T19:00:00Z"'; do
  reset_case
  if run_kurrentdb_bootstrap_retry >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap retry accepted a foreign or deleting ledger: $STATEFULSET_MUTATION" >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1
done
STATEFULSET_MUTATION='.'
for MANIFEST_MODE in foreign missing error; do
  reset_case
  if run_kurrentdb_bootstrap_retry >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap retry accepted invalid release manifest $MANIFEST_MODE." >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]]
done

# The rendered next release still includes bootstrap, and the normal deploy supplies its new image.
MODE=complete
MANIFEST_MODE=valid
reset_case
run_kurrentdb_bootstrap_prepare_update || exit 1
[[ "$(cat "$TEST_DIRECTORY/mutations")" == prepared ]] || exit 1
grep -Fq 'wait --for=delete' "$TEST_DIRECTORY/calls" || exit 1
helm_args=(upgrade --install "$RELEASE" "$TEST_DIRECTORY/desired-release.yaml")
normal_helm_dispatch="$(grep -Fx 'helm "${helm_args[@]}" || exit $?' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh")"
[[ -n "$normal_helm_dispatch" ]] || exit 1
eval "$normal_helm_dispatch"
[[ "$(cat "$TEST_DIRECTORY/mutations")" == $'prepared\nhelm-created' ]] || exit 1
jq -e '.spec.template.spec.containers[0].image == "example.test/bootstrap@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"' "$TEST_DIRECTORY/created.json" >/dev/null || exit 1

for MODE in missing active failed foreign foreign-instance missing-instance deleting error malformed uid-race version-race; do
  reset_case
  prepare_status=0
  run_kurrentdb_bootstrap_prepare_update >"$TEST_DIRECTORY/result" 2>&1 || prepare_status=$?
  if [[ "$MODE" == missing ]]; then
    [[ "$prepare_status" == 0 ]] || exit 1
  else
    [[ "$prepare_status" != 0 ]] || { echo "Bootstrap preparation accepted forbidden case $MODE." >&2; exit 1; }
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1
  if [[ "$MODE" == uid-race || "$MODE" == version-race ]]; then
    [[ "$prepare_status" == 8 && -s "$TEST_DIRECTORY/delete-options.json" ]] || exit 1
  fi
done
MODE=complete
for JOB_MUTATION in \
  '.apiVersion = "foreign/v1"' '.kind = "Deployment"' \
  '.metadata.name = "foreign-bootstrap"' '.metadata.namespace = "foreign"' \
  '.metadata.annotations["meta.helm.sh/release-namespace"] = "foreign"' \
  '.metadata.labels["app.kubernetes.io/component"] = "foreign"' \
  '.status.active = 1' '.status.terminating = 1' \
  '.status.conditions += [{type: "Failed", status: "True"}]' \
  '.status.conditions += [{type: "FailureTarget", status: "True"}]' \
  '.status.conditions[0].status = "False"' \
  'del(.metadata.uid)' '.metadata.uid = ""' \
  'del(.metadata.resourceVersion)' '.metadata.resourceVersion = 12345'; do
  reset_case
  if run_kurrentdb_bootstrap_prepare_update >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap preparation accepted invalid Job: $JOB_MUTATION" >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1
done
JOB_MUTATION='.'
for READY in 0 error; do
  reset_case
  if run_kurrentdb_bootstrap_prepare_update >"$TEST_DIRECTORY/result" 2>&1; then
    echo 'Bootstrap preparation accepted an unavailable ledger.' >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1
done
READY=1
for MANIFEST_MODE in foreign missing error; do
  reset_case
  if run_kurrentdb_bootstrap_prepare_update >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap preparation accepted invalid release manifest $MANIFEST_MODE." >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1
done
MANIFEST_MODE=valid
for maintenance_failure in delete wait; do
  reset_case
  DELETE_FAILURE=0
  WAIT_FAILURE=0
  if [[ "$maintenance_failure" == delete ]]; then DELETE_FAILURE=19; else WAIT_FAILURE=19; fi
  prepare_status=0
  run_kurrentdb_bootstrap_prepare_update >"$TEST_DIRECTORY/result" 2>&1 || prepare_status=$?
  [[ "$prepare_status" == 19 ]] || exit 1
  if [[ "$maintenance_failure" == delete ]]; then [[ ! -s "$TEST_DIRECTORY/mutations" ]] || exit 1; fi
done
echo '[kurrentdb-bootstrap-retry-contract] passed'
