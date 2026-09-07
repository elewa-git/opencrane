#!/usr/bin/env bash
# A bootstrap retry replaces only the failed release Job and never restores or scales its ledger.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
RELEASE=opencrane-testv5
NAMESPACE=opencrane-testv5
TIMEOUT=20
MODE=failed
READY=1
MANIFEST_MODE=valid
log() { :; }
err() { printf '%s\n' "$*" >&2; }
wait_for_final_kurrentdb_bootstrap_job_if_present() { printf 'verified\n' >>"$TEST_DIRECTORY/calls"; }

cat >"$TEST_DIRECTORY/release.yaml" <<'YAML'
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: unrelated
---
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-testv5-kurrentdb-bootstrap
  labels:
    app.kubernetes.io/instance: opencrane-testv5
    app.kubernetes.io/component: kurrentdb-bootstrap
spec:
  template:
    spec:
      containers:
        - name: bootstrap
          image: example.test/bootstrap@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      restartPolicy: Never
YAML
jq -n --arg release "$RELEASE" --arg namespace "$NAMESPACE" '{
  apiVersion: "batch/v1", kind: "Job", metadata: {
    name: ($release + "-kurrentdb-bootstrap"), namespace: $namespace,
    annotations: {"meta.helm.sh/release-name": $release, "meta.helm.sh/release-namespace": $namespace},
    labels: {"app.kubernetes.io/instance": $release, "app.kubernetes.io/component": "kurrentdb-bootstrap"}
  }, status: {conditions: [{type: "Failed", status: "True"}]}
}' >"$TEST_DIRECTORY/job.json"

helm()
{
  [[ "$*" == "get manifest $RELEASE -n $NAMESPACE" ]] || return 9
  case "$MANIFEST_MODE" in
    valid) cat "$TEST_DIRECTORY/release.yaml" ;;
    foreign) sed 's/app.kubernetes.io\/instance: opencrane-testv5/app.kubernetes.io\/instance: foreign/' "$TEST_DIRECTORY/release.yaml" ;;
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
        missing) return 0 ;;
        active) jq '.status = {active: 1}' "$TEST_DIRECTORY/job.json" ;;
        complete) jq '.status.conditions[0].type = "Complete"' "$TEST_DIRECTORY/job.json" ;;
        foreign) jq '.metadata.annotations["meta.helm.sh/release-name"] = "foreign"' "$TEST_DIRECTORY/job.json" ;;
        deleting) jq '.metadata.deletionTimestamp = "2026-09-07T19:00:00Z"' "$TEST_DIRECTORY/job.json" ;;
        race)
          if (( count > 0 )); then jq '.status = {active: 1}' "$TEST_DIRECTORY/job.json";
          else cat "$TEST_DIRECTORY/job.json"; fi
          ;;
        *) cat "$TEST_DIRECTORY/job.json" ;;
      esac
      ;;
    get:statefulset/*)
      jq -n --arg release "$RELEASE" --arg namespace "$NAMESPACE" --argjson ready "$READY" '{kind: "StatefulSet", metadata: {name: ($release + "-kurrentdb"), namespace: $namespace, labels: {"app.kubernetes.io/instance": $release}}, status: {readyReplicas: $ready}}'
      ;;
    annotate:--local)
      node -e 'const yaml = require(process.argv[1]); const doc = yaml.load(require("node:fs").readFileSync(0, "utf8")); if (!doc) process.exit(1); doc.metadata.annotations = {"meta.helm.sh/release-name": process.argv[2], "meta.helm.sh/release-namespace": process.argv[3]}; process.stdout.write(JSON.stringify(doc));' "$ROOT_DIR/node_modules/js-yaml" "$RELEASE" "$NAMESPACE"
      ;;
    delete:-f) printf 'deleted\n' >>"$TEST_DIRECTORY/mutations" ;;
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
for MODE in active complete foreign deleting error race; do
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
for MANIFEST_MODE in foreign missing error; do
  reset_case
  if run_kurrentdb_bootstrap_retry >"$TEST_DIRECTORY/result" 2>&1; then
    echo "Bootstrap retry accepted invalid release manifest $MANIFEST_MODE." >&2; exit 1
  fi
  [[ ! -s "$TEST_DIRECTORY/mutations" ]]
done
echo '[kurrentdb-bootstrap-retry-contract] passed'
