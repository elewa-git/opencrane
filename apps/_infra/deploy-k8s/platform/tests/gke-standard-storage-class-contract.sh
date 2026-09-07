#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-standard-storage-contract.XXXXXX")"
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
[[ "$1" == --context && "$2" == gke_fixture_europe-west1_fixture && "$3" == --request-timeout=30s ]] || exit 1
shift 3
case "$*" in
  'get csidriver.storage.k8s.io pd.csi.storage.gke.io -o json')
    [[ "${MOCK_FAILURE:-}" != driver ]] || exit 1
    if [[ "${MOCK_FAILURE:-}" == wrong-driver ]]; then
      printf '{"apiVersion":"storage.k8s.io/v1","kind":"CSIDriver","metadata":{"name":"foreign"}}\n'
    elif [[ "${MOCK_FAILURE:-}" == deleting-driver ]]; then
      printf '{"apiVersion":"storage.k8s.io/v1","kind":"CSIDriver","metadata":{"name":"pd.csi.storage.gke.io","deletionTimestamp":"2026-09-07T00:00:00Z"}}\n'
    else
      printf '{"apiVersion":"storage.k8s.io/v1","kind":"CSIDriver","metadata":{"name":"pd.csi.storage.gke.io"}}\n'
    fi
    ;;
  'get storageclass opencrane-pd-standard --ignore-not-found -o json')
    [[ "${MOCK_FAILURE:-}" != inventory ]] || exit 1
    if [[ -f "$MOCK_CLASS" ]]; then cat "$MOCK_CLASS"; fi
    ;;
  'create -f - -o json')
    [[ "${MOCK_FAILURE:-}" != create-race ]] || exit 1
    cat >"$MOCK_CREATED"
    cp "$MOCK_CREATED" "$MOCK_CLASS"
    if [[ "${MOCK_FAILURE:-}" == mutated-create ]]; then
      jq '.parameters.type = "pd-balanced"' "$MOCK_CLASS"
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
ARGS=(--provision-gke-standard-storage-class opencrane-pd-standard --context gke_fixture_europe-west1_fixture)

_assert_no_mutation()
{
  if [[ -e "$MOCK_CREATED" ]] || grep -Eq ' create | patch | apply | delete |Unexpected Helm' "$MOCK_CALLS"; then
    echo 'A rejected or repeated prerequisite changed a resource or entered Helm.' >&2
    exit 1
  fi
}

# The public action must create only the fixed class without entering ordinary installation.
"$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output"
jq -e '
  .apiVersion == "storage.k8s.io/v1" and .kind == "StorageClass"
  and .metadata.name == "opencrane-pd-standard"
  and .metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-prerequisite-bootstrap"
  and .metadata.labels["opencrane.ai/prerequisite"] == "gke-pd-standard-storage-class"
  and .provisioner == "pd.csi.storage.gke.io" and .parameters == {"type":"pd-standard"}
  and .reclaimPolicy == "Delete" and .volumeBindingMode == "WaitForFirstConsumer"
  and .allowVolumeExpansion == true and .metadata.annotations == null
  and .mountOptions == null and .allowedTopologies == null
' >/dev/null "$MOCK_CREATED"
cp "$MOCK_CLASS" "$TEST_DIR/owned.json"
rm "$MOCK_CREATED"
: >"$MOCK_CALLS"
"$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output"
_assert_no_mutation
cmp "$TEST_DIR/owned.json" "$MOCK_CLASS"
grep -Fq 'Verified existing class' "$TEST_DIR/output"

# Matching names never authorise adoption, policy changes, or defaults under either annotation.
for mutation in \
  'del(.metadata.labels)' \
  '.metadata.labels["app.kubernetes.io/managed-by"] = "foreign"' \
  '.metadata.labels["opencrane.ai/prerequisite"] = "foreign"' \
  '.provisioner = "kubernetes.io/gce-pd"' \
  '.parameters.type = "pd-balanced"' \
  '.parameters["replication-type"] = "regional-pd"' \
  '.allowVolumeExpansion = false' \
  '.volumeBindingMode = "Immediate"' \
  '.reclaimPolicy = "Retain"' \
  '.metadata.annotations["storageclass.kubernetes.io/is-default-class"] = "true"' \
  '.metadata.annotations["storageclass.kubernetes.io/is-default-class"] = "false"' \
  '.metadata.annotations["storageclass.beta.kubernetes.io/is-default-class"] = "true"' \
  '.mountOptions = ["discard"]' \
  '.allowedTopologies = [{"matchLabelExpressions":[]}]' \
  '.metadata.deletionTimestamp = "2026-09-07T00:00:00Z"'; do
  jq "$mutation" "$TEST_DIR/owned.json" >"$MOCK_CLASS"
  : >"$MOCK_CALLS"
  if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Storage class accepted conflict: $mutation" >&2
    exit 1
  fi
  grep -Fq 'refusing to adopt or alter' "$TEST_DIR/output"
  _assert_no_mutation
done

for failure in driver wrong-driver deleting-driver inventory create-race mutated-create; do
  export MOCK_FAILURE="$failure"
  rm -f "$MOCK_CLASS" "$MOCK_CREATED"
  : >"$MOCK_CALLS"
  if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Storage class ignored failed $failure check." >&2
    exit 1
  fi
  if [[ "$failure" != create-race && "$failure" != mutated-create ]]; then _assert_no_mutation; fi
  if [[ "$failure" == create-race ]]; then [[ ! -e "$MOCK_CREATED" ]] || exit 1; fi
done
unset MOCK_FAILURE
rm -f "$MOCK_CLASS" "$MOCK_CREATED"
: >"$MOCK_CALLS"
export MOCK_CONTEXT=gke_other_europe-west1_other
if "$DEPLOY" "${ARGS[@]}" >"$TEST_DIR/output" 2>&1; then
  echo 'Storage class accepted a different current context.' >&2
  exit 1
fi
_assert_no_mutation
[[ "$(wc -l <"$MOCK_CALLS" | tr -d ' ')" == 1 ]] || exit 1
export MOCK_CONTEXT=gke_fixture_europe-west1_fixture
for invalid_args in missing-name missing-context missing-value invalid-name long-name mixed-action duplicate-context; do
  case "$invalid_args" in
    missing-name) rejected=(--provision-gke-standard-storage-class) ;;
    missing-context) rejected=(--provision-gke-standard-storage-class opencrane-pd-standard) ;;
    missing-value) rejected=(--provision-gke-standard-storage-class opencrane-pd-standard --context) ;;
    invalid-name) rejected=(--provision-gke-standard-storage-class '../foreign' --context "$MOCK_CONTEXT") ;;
    long-name) rejected=(--provision-gke-standard-storage-class "$(printf '%064d' 0)" --context "$MOCK_CONTEXT") ;;
    mixed-action) rejected=("${ARGS[@]}" --kurrentdb-restore latest) ;;
    duplicate-context) rejected=("${ARGS[@]}" --context "$MOCK_CONTEXT") ;;
  esac
  : >"$MOCK_CALLS"
  if "$DEPLOY" "${rejected[@]}" >"$TEST_DIR/output" 2>&1; then
    echo "Storage class accepted invalid arguments: $invalid_args" >&2
    exit 1
  fi
  [[ ! -s "$MOCK_CALLS" ]] || exit 1
done
"$DEPLOY" --provision-gke-standard-storage-class --help >"$TEST_DIR/output"
[[ ! -s "$MOCK_CALLS" ]] || exit 1
echo 'GKE standard storage class prerequisite contract: PASS'
