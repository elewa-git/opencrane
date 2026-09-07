#!/usr/bin/env bash
# A bootstrap retry replaces only the failed release Job and never restores or scales its ledger.
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
log() { :; }
err() { printf '%s\n' "$*" >&2; }
wait_for_final_kurrentdb_bootstrap_job_if_present() { printf 'verified\n' >>"$TEST_DIRECTORY/calls"; }

# Start from the chart's actual labels; Helm supplies ownership annotations on live resources.
prepare_current_chart_sources
helm template "$RELEASE" "$(current_chart_sources_dir)" --namespace "$NAMESPACE" \
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
    resource.status = kind === "Job" ? {conditions: [{type: "Failed", status: "True"}]} : {readyReplicas: 1};
    fs.writeFileSync(directory + "/" + file + ".json", JSON.stringify(resource));
  }
' "$ROOT_DIR/node_modules/js-yaml" "$TEST_DIRECTORY" "$RELEASE" "$NAMESPACE"

helm()
{
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
        missing) return 0 ;;
        active) jq '.status = {active: 1}' "$TEST_DIRECTORY/job.json" ;;
        complete) jq '.status.conditions[0].type = "Complete"' "$TEST_DIRECTORY/job.json" ;;
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
      jq --argjson ready "$READY" "$STATEFULSET_MUTATION | .status.readyReplicas = \$ready" "$TEST_DIRECTORY/statefulset.json"
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
echo '[kurrentdb-bootstrap-retry-contract] passed'
