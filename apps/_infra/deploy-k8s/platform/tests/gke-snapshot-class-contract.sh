#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-snapshot-class-contract.XXXXXX")"
trap 'rm -rf -- "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"
export MOCK_CALLS="$TEST_DIR/calls" MOCK_CLASS="$TEST_DIR/class.json" MOCK_CREATED="$TEST_DIR/created.json"
export MOCK_CONTEXT=gke_fixture_europe-west1_fixture

cat >"$TEST_DIR/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'kubectl %s\n' "$*" >>"$MOCK_CALLS"
if [[ "$*" == 'config current-context' ]]; then
  printf '%s\n' "$MOCK_CONTEXT"
  exit 0
fi
[[ "$1" == --context && "$2" == gke_fixture_europe-west1_fixture && "$3" == --request-timeout=30s ]]
shift 3
case "$*" in
  'get --raw /apis/snapshot.storage.k8s.io/v1')
    [[ "${MOCK_FAILURE:-}" != api ]] || exit 1
    if [[ "${MOCK_FAILURE:-}" == incomplete-api ]]; then
      printf '{"groupVersion":"snapshot.storage.k8s.io/v1","resources":[]}\n'
    else
      printf '{"groupVersion":"snapshot.storage.k8s.io/v1","resources":[{"name":"volumesnapshotclasses","namespaced":false},{"name":"volumesnapshotcontents","namespaced":false},{"name":"volumesnapshots","namespaced":true}]}\n'
    fi
    ;;
  'get csidriver.storage.k8s.io pd.csi.storage.gke.io -o json')
    [[ "${MOCK_FAILURE:-}" != driver ]] || exit 1
    printf '{"metadata":{"name":"pd.csi.storage.gke.io"}}\n'
    ;;
  'get storageclass standard-rwo -o json')
    [[ "${MOCK_FAILURE:-}" != storage ]] || exit 1
    if [[ "${MOCK_FAILURE:-}" == wrong-storage-driver ]]; then
      printf '{"metadata":{"name":"standard-rwo"},"provisioner":"kubernetes.io/gce-pd"}\n'
    else
      printf '{"metadata":{"name":"standard-rwo"},"provisioner":"pd.csi.storage.gke.io"}\n'
    fi
    ;;
  'get volumesnapshotclass opencrane-pd-snapshots --ignore-not-found -o json')
    [[ "${MOCK_FAILURE:-}" != inventory ]] || exit 1
    if [[ -f "$MOCK_CLASS" ]]; then cat "$MOCK_CLASS"; fi
    ;;
  'create -f - -o json')
    [[ "${MOCK_FAILURE:-}" != create ]] || exit 1
    cat >"$MOCK_CREATED"
    cp "$MOCK_CREATED" "$MOCK_CLASS"
    if [[ "${MOCK_FAILURE:-}" == mutated-create ]]; then
      jq '.deletionPolicy = "Retain"' "$MOCK_CLASS"
    else
      cat "$MOCK_CLASS"
    fi
    ;;
  *) printf 'Unexpected kubectl command: %s\n' "$*" >&2; exit 1 ;;
esac
MOCK
cat >"$TEST_DIR/bin/helm" <<'MOCK'
#!/usr/bin/env bash
printf 'Unexpected Helm invocation: %s\n' "$*" >>"$MOCK_CALLS"
exit 1
MOCK
chmod +x "$TEST_DIR/bin/kubectl" "$TEST_DIR/bin/helm"
export PATH="$TEST_DIR/bin:$PATH"
unset OPENCRANE_CHART_DIR
ARGS=(--provision-gke-snapshot-class opencrane-pd-snapshots --context gke_fixture_europe-west1_fixture --storage-class standard-rwo)

# The actual entrypoint must complete without Helm, a release manifest, or identity inputs.
"$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output"
jq -e '
  .apiVersion == "snapshot.storage.k8s.io/v1" and .kind == "VolumeSnapshotClass"
  and .metadata.name == "opencrane-pd-snapshots"
  and .metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-prerequisite-bootstrap"
  and .metadata.labels["opencrane.ai/prerequisite"] == "gke-pd-snapshot-class"
  and .driver == "pd.csi.storage.gke.io" and .deletionPolicy == "Delete"
  and .metadata.annotations == null and .parameters == null
' >/dev/null "$MOCK_CREATED"
cp "$MOCK_CLASS" "$TEST_DIR/owned.json"
rm "$MOCK_CREATED"
: >"$MOCK_CALLS"
"$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output"
[[ ! -e "$MOCK_CREATED" ]]
grep -Fq 'Verified existing class' "$TEST_DIR/output"
if grep -Eq ' create | patch | apply |Unexpected Helm' "$MOCK_CALLS"; then
  echo 'An identical retry changed a resource or entered Helm.' >&2
  exit 1
fi

# A matching name or policy never authorises adoption of a foreign or changed class.
for mutation in \
  'del(.metadata.labels)' \
  '.metadata.labels["opencrane.ai/prerequisite"] = "foreign"' \
  '.driver = "filestore.csi.storage.gke.io"' \
  '.deletionPolicy = "Retain"' \
  '.metadata.annotations["snapshot.storage.kubernetes.io/is-default-class"] = "true"' \
  '.parameters["storage-locations"] = "us-central1"' \
  '.metadata.deletionTimestamp = "2026-09-07T00:00:00Z"'; do
  jq "$mutation" "$TEST_DIR/owned.json" >"$MOCK_CLASS"
  : >"$MOCK_CALLS"
  if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Snapshot class accepted conflict: $mutation" >&2
    exit 1
  fi
  grep -Fq 'refusing to adopt or alter' "$TEST_DIR/output"
  [[ ! -e "$MOCK_CREATED" ]]
done
rm "$MOCK_CLASS"

for failure in api incomplete-api driver storage wrong-storage-driver inventory create mutated-create; do
  export MOCK_FAILURE="$failure"
  rm -f "$MOCK_CLASS" "$MOCK_CREATED"
  : >"$MOCK_CALLS"
  if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Snapshot class ignored failed $failure check." >&2
    exit 1
  fi
  if [[ "$failure" != mutated-create ]]; then [[ ! -e "$MOCK_CREATED" ]]; fi
done
unset MOCK_FAILURE
rm -f "$MOCK_CLASS" "$MOCK_CREATED"
export MOCK_CONTEXT=gke_other_europe-west1_other
if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
  echo 'Snapshot class accepted a different current context.' >&2
  exit 1
fi
[[ ! -e "$MOCK_CREATED" ]]
export MOCK_CONTEXT=gke_fixture_europe-west1_fixture
for invalid_args in missing-context missing-storage missing-value invalid-name mixed-action; do
  case "$invalid_args" in
    missing-context) rejected=(--provision-gke-snapshot-class opencrane-pd-snapshots --storage-class standard-rwo) ;;
    missing-storage) rejected=(--provision-gke-snapshot-class opencrane-pd-snapshots --context "$MOCK_CONTEXT") ;;
    missing-value) rejected=(--provision-gke-snapshot-class opencrane-pd-snapshots --context) ;;
    invalid-name) rejected=(--provision-gke-snapshot-class '../foreign' --context "$MOCK_CONTEXT" --storage-class standard-rwo) ;;
    mixed-action) rejected=("${ARGS[@]}" --kurrentdb-restore latest) ;;
  esac
  if "$DEPLOY" "${rejected[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Snapshot class accepted invalid arguments: $invalid_args" >&2
    exit 1
  fi
  [[ ! -e "$MOCK_CREATED" ]]
done
echo 'GKE snapshot class prerequisite contract: PASS'
