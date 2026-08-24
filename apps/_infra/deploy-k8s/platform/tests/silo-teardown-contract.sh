#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
WRAPPER="$ROOT_DIR/apps/_infra/deploy-k8s/teardown.sh"
CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-teardown.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-teardown-contract.XXXXXX")"
MOCK_BIN="$TEST_DIR/bin"
mkdir -p "$MOCK_BIN"
trap 'rm -rf -- "$TEST_DIR"' EXIT

grep -Fq "jsonpath={.data.lease-private\\.pem}" "$CORE"
grep -Fq "jsonpath={.data.receipt-private\\.pem}" "$CORE"
if grep -Fq "jsonpath={.data.lease-private\\\\.pem}" "$CORE" || grep -Fq "jsonpath={.data.receipt-private\\\\.pem}" "$CORE"; then
  echo 'interrupted artifact key JSONPath is over-escaped' >&2
  exit 1
fi

cat >"$MOCK_BIN/command-mock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
command_name="$(basename "$0")"
printf '%s %s\n' "$command_name" "$*" >>"$MOCK_CALLS"
case "$command_name" in
  helm)
    if [[ "$1" == "list" ]]; then
      [[ "${MOCK_HELM_LIST_FAILURE:-0}" == "0" ]] || exit 1
      namespace=""; filter=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --namespace) namespace="$2"; shift 2 ;;
          --filter) filter="$2"; shift 2 ;;
          *) shift ;;
        esac
      done
      if [[ "$namespace" != "opencrane-retired-fixture" ]]; then
        if [[ "${MOCK_AUX_RELEASE:-0}" == "1" && "$namespace" == "opencrane-retired-fixture-artifacts" ]]; then
          printf '[{"name":"opencrane-retired-fixture","chart":"unrelated-1.0.0"}]\n'
        else
          printf '[]\n'
        fi
        exit 0
      fi
      main='{"name":"opencrane-retired-fixture","chart":"opencrane-silo-0.7.0"}'
      postgres='{"name":"opencrane-retired-fixture-postgres","chart":"postgres-0.6.2"}'
      [[ "${MOCK_FOREIGN_MAIN_CHART:-0}" == "0" ]] || main='{"name":"opencrane-retired-fixture","chart":"foreign-chart-1.0.0"}'
      items=()
      [[ -e "$MOCK_STATE/main-uninstalled" ]] || items+=("$main")
      [[ -e "$MOCK_STATE/postgres-uninstalled" ]] || items+=("$postgres")
      [[ "${MOCK_FOREIGN_RELEASE:-0}" == "0" ]] || items+=('{"name":"other-system","chart":"foreign-1.0.0"}')
      if [[ -n "$filter" ]]; then
        requested="${filter#^}"; requested="${requested%$}"; filtered=()
        for item in "${items[@]-}"; do [[ "$item" == *"\"name\":\"$requested\""* ]] && filtered+=("$item"); done
        items=("${filtered[@]-}")
      fi
      if [[ "${#items[@]}" -eq 0 || -z "${items[0]:-}" ]]; then printf '[]\n'; else
        printf '[%s' "${items[0]}"
        for ((i=1; i<${#items[@]}; i++)); do printf ',%s' "${items[$i]}"; done
        printf ']\n'
      fi
      exit 0
    fi
    if [[ "$1" == "uninstall" ]]; then
      [[ "$2" == "opencrane-retired-fixture" ]] && touch "$MOCK_STATE/main-uninstalled"
      [[ "$2" == "opencrane-retired-fixture-postgres" ]] && touch "$MOCK_STATE/postgres-uninstalled"
      exit 0
    fi
    ;;
  kubectl)
    if [[ "$*" == "config current-context" ]]; then printf '%s\n' "${MOCK_CURRENT_CONTEXT:-gke_opencrane-dev}"; exit 0; fi
    if [[ "${MOCK_KUBECTL_GET_FAILURE:-0}" == "1" && "$*" == *" get "* ]]; then exit 1; fi
    if [[ "$*" == *" get namespace/opencrane-retired-fixture-artifacts"* ]]; then
      [[ ! -e "$MOCK_STATE/artifact-namespace-deleted" ]] || exit 0
      printf 'namespace/opencrane-retired-fixture-artifacts'; exit 0
    fi
    if [[ "$*" == *" get namespace/opencrane-retired-fixture --ignore-not-found"* || "$*" == *" get namespace opencrane-retired-fixture -o "* ]]; then
      [[ ! -e "$MOCK_STATE/main-namespace-deleted" ]] || exit 0
      printf 'namespace/opencrane-retired-fixture'; exit 0
    fi
    if [[ "$*" == *" get namespace/"* || "$*" == *" get namespace "* ]]; then exit 0; fi
    if [[ "$*" == *" get secret opencrane-retired-fixture-artifact-catalog-keys "* ]]; then
      [[ "${MOCK_INTERRUPTED_ARTIFACT_KEYS:-0}" == "1" ]] && printf 'catalog-key'
      exit 0
    fi
    if [[ "$*" == *" get secret opencrane-retired-fixture-artifact-service-keys "* ]]; then
      [[ "${MOCK_INTERRUPTED_ARTIFACT_KEYS:-0}" == "1" ]] && printf 'service-key'
      exit 0
    fi
    if [[ "$*" == *" get deployment/opencrane-retired-fixture-artifact-service "*"app\\.kubernetes\\.io/instance"* ]]; then
      printf 'opencrane-retired-fixture'; exit 0
    fi
    if [[ "$*" == *" get deployment/opencrane-retired-fixture-artifact-service "*"app\\.kubernetes\\.io/managed-by"* ]]; then
      printf 'Helm'; exit 0
    fi
    if [[ "$*" == *" get deployment/opencrane-retired-fixture-artifact-service "*"meta\\.helm\\.sh/release-name"* ]]; then
      if [[ "${MOCK_FOREIGN_SENTINEL_OWNER:-0}" == "1" ]]; then printf 'foreign'; else printf 'opencrane-retired-fixture'; fi
      exit 0
    fi
    if [[ "$*" == *" get deployment/opencrane-retired-fixture-artifact-service "*"meta\\.helm\\.sh/release-namespace"* ]]; then
      printf 'opencrane-retired-fixture'; exit 0
    fi
    resource=""
    case "$*" in
      *" get cluster/opencrane-retired-fixture-postgres "*) resource="cluster" ;;
      *" get database/opencrane-retired-fixture-postgres-obot "*) resource="obot" ;;
      *" get database/opencrane-retired-fixture-postgres-litellm "*) resource="litellm" ;;
    esac
    if [[ -n "$resource" ]]; then
      if [[ -e "$MOCK_STATE/$resource-deleted" ]]; then
        [[ "$*" == *"--ignore-not-found"* ]] && exit 0
        exit 1
      fi
      case "$*" in
        *" -o name"*) printf '%s' "$resource" ;;
        *"app\\.kubernetes\\.io/instance"*)
          if [[ "${MOCK_FOREIGN_CNPG:-0}" == "1" ]]; then printf 'other-postgres'; else printf 'opencrane-retired-fixture-postgres'; fi ;;
        *"app\\.kubernetes\\.io/managed-by"*) printf 'Helm' ;;
      esac
      exit 0
    fi
    if [[ "$*" == *" get clusterrole/"* || "$*" == *" get clusterrolebinding/"* ]]; then
      case "$*" in
        *" -o name"*) printf '%s' 'rbac' ;;
        *"app\\.kubernetes\\.io/managed-by"*) printf '%s' 'Helm' ;;
        *"meta\\.helm\\.sh/release-namespace"*)
          if [[ "${MOCK_FOREIGN_RBAC_NAMESPACE:-0}" == "1" ]]; then printf '%s' 'foreign-namespace'; else printf '%s' 'opencrane-retired-fixture'; fi ;;
        *"meta\\.helm\\.sh/release-name"*)
          if [[ "${MOCK_FOREIGN_RBAC:-0}" == "1" ]]; then printf '%s' 'foreign'; else printf '%s' 'opencrane-retired-fixture'; fi ;;
      esac
      exit 0
    fi
    if [[ "$*" == *" get "* ]]; then
      [[ "$*" == *"--ignore-not-found"* ]] && exit 0
      exit 1
    fi
    if [[ "$*" == *" delete database/opencrane-retired-fixture-postgres-obot "* ]]; then touch "$MOCK_STATE/obot-deleted"; exit 0; fi
    if [[ "$*" == *" delete database/opencrane-retired-fixture-postgres-litellm "* ]]; then touch "$MOCK_STATE/litellm-deleted"; exit 0; fi
    if [[ "$*" == *" delete cluster/opencrane-retired-fixture-postgres "* ]]; then touch "$MOCK_STATE/cluster-deleted"; exit 0; fi
    if [[ "$*" == *" delete namespace opencrane-retired-fixture-artifacts "* ]]; then touch "$MOCK_STATE/artifact-namespace-deleted"; exit 0; fi
    if [[ "$*" == *" delete namespace opencrane-retired-fixture "* ]]; then touch "$MOCK_STATE/main-namespace-deleted"; exit 0; fi
    if [[ "$*" == *" label namespace opencrane-retired-fixture-artifacts "* ]]; then touch "$MOCK_STATE/artifact-labelled"; exit 0; fi
    if [[ "$*" == *" delete "* ]]; then exit 0; fi
    ;;
esac
MOCK
chmod +x "$MOCK_BIN/command-mock"
for command_name in helm kubectl; do ln -s "$MOCK_BIN/command-mock" "$MOCK_BIN/$command_name"; done

common_core_args=(
  --context gke_opencrane-dev
  --cluster-tenant retired-fixture
  --expected-main-chart opencrane-silo-0.7.0
  --expected-postgres-chart postgres-0.6.2
  --confirm-retire retired-fixture
)
run_core() {
  local case_name="$1"; shift
  local state="$TEST_DIR/$case_name.state"; mkdir -p "$state"
  env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/$case_name.calls" MOCK_STATE="$state" "$@" \
    bash "$CORE" "${common_core_args[@]}" >"$TEST_DIR/$case_name.output" 2>&1
}

if run_core wrong-context MOCK_CURRENT_CONTEXT=other-cluster; then echo 'wrong context unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/wrong-context.calls"

mkdir -p "$TEST_DIR/missing-confirm.state"
: >"$TEST_DIR/missing-confirm.calls"
if env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/missing-confirm.calls" MOCK_STATE="$TEST_DIR/missing-confirm.state" \
  bash "$CORE" --context gke_opencrane-dev --cluster-tenant retired-fixture --confirm-retire wrong >"$TEST_DIR/missing-confirm.output" 2>&1; then
  echo 'missing exact confirmation unexpectedly succeeded' >&2; exit 1
fi
! grep -Fq ' delete ' "$TEST_DIR/missing-confirm.calls"

if run_core foreign-owner MOCK_FOREIGN_CNPG=1; then echo 'foreign CNPG ownership unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/foreign-owner.calls"
if run_core foreign-rbac MOCK_FOREIGN_RBAC=1; then echo 'foreign RBAC ownership unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/foreign-rbac.calls"
if run_core foreign-rbac-namespace MOCK_FOREIGN_RBAC_NAMESPACE=1; then echo 'foreign RBAC namespace unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/foreign-rbac-namespace.calls"
if run_core foreign-release MOCK_FOREIGN_RELEASE=1; then
  echo 'foreign Helm ownership unexpectedly succeeded' >&2
  cat "$TEST_DIR/foreign-release.output" >&2
  cat "$TEST_DIR/foreign-release.calls" >&2
  exit 1
fi
! grep -Fq ' delete ' "$TEST_DIR/foreign-release.calls"
if run_core helm-read-failure MOCK_HELM_LIST_FAILURE=1; then echo 'Helm read failure unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/helm-read-failure.calls"
if run_core kubectl-read-failure MOCK_KUBECTL_GET_FAILURE=1; then echo 'kubectl read failure unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/kubectl-read-failure.calls"
if run_core auxiliary-release MOCK_AUX_RELEASE=1; then echo 'auxiliary Helm release unexpectedly succeeded' >&2; exit 1; fi
! grep -Fq ' delete ' "$TEST_DIR/auxiliary-release.calls"
if run_core foreign-sentinel-owner MOCK_FOREIGN_SENTINEL_OWNER=1; then
  echo 'foreign auxiliary sentinel ownership unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq ' delete ' "$TEST_DIR/foreign-sentinel-owner.calls"

mkdir -p "$TEST_DIR/interrupted-missing-keys.state"
touch "$TEST_DIR/interrupted-missing-keys.state/main-uninstalled"
if env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/interrupted-missing-keys.calls" MOCK_STATE="$TEST_DIR/interrupted-missing-keys.state" \
  bash "$CORE" "${common_core_args[@]}" --preflight >"$TEST_DIR/interrupted-missing-keys.output" 2>&1; then
  echo 'interrupted artifact namespace without both keys unexpectedly succeeded' >&2
  exit 1
fi
grep -Fq 'two deploy-created key Secrets are incomplete' "$TEST_DIR/interrupted-missing-keys.output"
! grep -Fq ' delete ' "$TEST_DIR/interrupted-missing-keys.calls"

mkdir -p "$TEST_DIR/interrupted-preflight.state"
touch "$TEST_DIR/interrupted-preflight.state/main-uninstalled"
if ! env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/interrupted-preflight.calls" MOCK_STATE="$TEST_DIR/interrupted-preflight.state" \
  MOCK_INTERRUPTED_ARTIFACT_KEYS=1 bash "$CORE" "${common_core_args[@]}" --preflight >"$TEST_DIR/interrupted-preflight.output" 2>&1; then
  cat "$TEST_DIR/interrupted-preflight.output" >&2
  exit 1
fi
! grep -Eq 'helm uninstall|kubectl .* (delete|label) ' "$TEST_DIR/interrupted-preflight.calls"

mkdir -p "$TEST_DIR/interrupted-success.state"
touch "$TEST_DIR/interrupted-success.state/main-uninstalled"
if ! env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/interrupted-success.calls" MOCK_STATE="$TEST_DIR/interrupted-success.state" \
  MOCK_INTERRUPTED_ARTIFACT_KEYS=1 bash "$CORE" "${common_core_args[@]}" >"$TEST_DIR/interrupted-success.output" 2>&1; then
  cat "$TEST_DIR/interrupted-success.output" >&2
  cat "$TEST_DIR/interrupted-success.calls" >&2
  exit 1
fi
grep -Fq 'helm uninstall opencrane-retired-fixture-postgres --kube-context gke_opencrane-dev --namespace opencrane-retired-fixture --wait' "$TEST_DIR/interrupted-success.calls"
grep -Fq 'delete namespace opencrane-retired-fixture-artifacts --ignore-not-found=true --wait=true' "$TEST_DIR/interrupted-success.calls"
grep -Fq 'delete namespace opencrane-retired-fixture --ignore-not-found=true --wait=true' "$TEST_DIR/interrupted-success.calls"

mkdir -p "$TEST_DIR/testv3.state"
: >"$TEST_DIR/testv3.calls"
if env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/testv3.calls" MOCK_STATE="$TEST_DIR/testv3.state" \
  bash "$CORE" --context gke_opencrane-dev --cluster-tenant testv3 \
    --expected-main-chart opencrane-silo-0.7.0 --expected-postgres-chart postgres-0.6.2 --confirm-retire testv3 >"$TEST_DIR/testv3.output" 2>&1; then
  echo 'protected testv3 teardown unexpectedly succeeded' >&2; exit 1
fi
! grep -Fq ' delete ' "$TEST_DIR/testv3.calls"

mkdir -p "$TEST_DIR/wrapper-protected.state"
: >"$TEST_DIR/wrapper-protected.calls"
if env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/wrapper-protected.calls" MOCK_STATE="$TEST_DIR/wrapper-protected.state" \
  bash "$WRAPPER" --context gke_opencrane-dev --cluster-tenant testv3 --base-domain dev.opencrane.ai \
    --release-version 0.7.0 --confirm-retire testv3 >"$TEST_DIR/wrapper-protected.output" 2>&1; then
  echo 'protected wrapper teardown unexpectedly succeeded' >&2
  exit 1
fi
grep -Fq "Protected active tenant 'testv3'" "$TEST_DIR/wrapper-protected.output"
! grep -Fq 'REMAINING EXTERNAL ACTION' "$TEST_DIR/wrapper-protected.output"
! grep -Fq ' delete ' "$TEST_DIR/wrapper-protected.calls"

mkdir -p "$TEST_DIR/preflight.state"
if ! env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/preflight.calls" MOCK_STATE="$TEST_DIR/preflight.state" \
  bash "$CORE" "${common_core_args[@]}" --preflight >"$TEST_DIR/preflight.output" 2>&1; then
  cat "$TEST_DIR/preflight.output" >&2
  cat "$TEST_DIR/preflight.calls" >&2
  exit 1
fi
! grep -Eq 'helm uninstall|kubectl .* (delete|label) ' "$TEST_DIR/preflight.calls"

if ! run_core success; then
  cat "$TEST_DIR/success.output" >&2
  cat "$TEST_DIR/success.calls" >&2
  exit 1
fi
SUCCESS_CALLS="$TEST_DIR/success.calls"
grep -Fq 'helm uninstall opencrane-retired-fixture --kube-context gke_opencrane-dev --namespace opencrane-retired-fixture --wait' "$SUCCESS_CALLS"
grep -Fq 'helm uninstall opencrane-retired-fixture-postgres --kube-context gke_opencrane-dev --namespace opencrane-retired-fixture --wait' "$SUCCESS_CALLS"
grep -Fq 'delete database/opencrane-retired-fixture-postgres-obot --namespace opencrane-retired-fixture --wait=true' "$SUCCESS_CALLS"
grep -Fq 'delete database/opencrane-retired-fixture-postgres-litellm --namespace opencrane-retired-fixture --wait=true' "$SUCCESS_CALLS"
grep -Fq 'delete cluster/opencrane-retired-fixture-postgres --namespace opencrane-retired-fixture --wait=true' "$SUCCESS_CALLS"
grep -Fq 'delete pvc --namespace opencrane-retired-fixture --selector app.kubernetes.io/instance=opencrane-retired-fixture-postgres,cnpg.io/cluster=opencrane-retired-fixture-postgres' "$SUCCESS_CALLS"
grep -Fq 'delete namespace opencrane-retired-fixture-artifacts --ignore-not-found=true --wait=true' "$SUCCESS_CALLS"
grep -Fq 'delete namespace opencrane-retired-fixture --ignore-not-found=true --wait=true' "$SUCCESS_CALLS"
! grep -Eq 'delete (crd|computeclass|namespace (opencrane-testv3|ingress-nginx|cert-manager|cnpg-system))' "$SUCCESS_CALLS"
! grep -Fq 'opencrane-testv3' "$SUCCESS_CALLS"

if ! env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/retry.calls" MOCK_STATE="$TEST_DIR/success.state" \
  bash "$CORE" "${common_core_args[@]}" >"$TEST_DIR/retry.output" 2>&1; then
  cat "$TEST_DIR/retry.output" >&2
  cat "$TEST_DIR/retry.calls" >&2
  exit 1
fi
! grep -Fq 'helm uninstall' "$TEST_DIR/retry.calls"

mkdir -p "$TEST_DIR/wrapper.state"
: >"$TEST_DIR/wrapper-missing.calls"
if env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/wrapper-missing.calls" MOCK_STATE="$TEST_DIR/wrapper.state" \
  bash "$WRAPPER" --context gke_opencrane-dev --cluster-tenant retired-fixture --base-domain dev.opencrane.ai --release-version 0.7.0 \
    --confirm-retire retired-fixture >"$TEST_DIR/wrapper-missing.output" 2>&1; then
  echo 'missing external retirement evidence unexpectedly succeeded' >&2; exit 1
fi
grep -Fq 'REMAINING EXTERNAL ACTION' "$TEST_DIR/wrapper-missing.output"
! grep -Fq ' delete ' "$TEST_DIR/wrapper-missing.calls"

echo 'silo teardown contract: PASS'
