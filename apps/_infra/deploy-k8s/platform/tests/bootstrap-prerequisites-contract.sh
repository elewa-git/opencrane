#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
BOOTSTRAP="$ROOT_DIR/apps/_infra/deploy-k8s/platform/bootstrap-prerequisites.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-prerequisites-contract.XXXXXX")"
MOCK_BIN="$TEST_DIR/bin"
mkdir -p "$MOCK_BIN"
trap 'rm -rf -- "$TEST_DIR"' EXIT

cat >"$MOCK_BIN/command-mock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

command_name="$(basename "$0")"
printf '%s %s\n' "$command_name" "$*" >>"$MOCK_CALLS"

case "$command_name" in
  gcloud)
    case "$*" in
      *"value(address)"*) printf '%s\n' "${MOCK_ADDRESS_IP:-35.205.225.244}" ;;
      *"value(status)"*) printf '%s\n' "${MOCK_ADDRESS_STATUS:-RESERVED}" ;;
      *"value(addressType)"*) printf '%s\n' "${MOCK_ADDRESS_TYPE:-EXTERNAL}" ;;
      *"value(region)"*) printf 'https://www.googleapis.com/compute/v1/projects/weownai-proto/regions/%s\n' "${MOCK_ADDRESS_REGION:-europe-west1}" ;;
    esac
    ;;
  helm)
    case "$1" in
      list)
        release="${MOCK_RELEASE_EXISTS:-}"
        if [[ -z "$release" ]]; then
          printf '[]\n'
          exit 0
        fi
        chart="${MOCK_RELEASE_CHART:-${release}-1.0.0}"
        printf '[{"name":"%s","chart":"%s"}]\n' "$release" "$chart"
        ;;
      template)
        [[ "${MOCK_RENDER_FAIL:-0}" == "0" ]]
        ;;
      pull)
        chart="$2"
        version=""
        destination=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --version) version="$2"; shift 2 ;;
            --destination) destination="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        touch "$destination/${chart}-${version}.tgz"
        ;;
      upgrade)
        touch "$MOCK_MUTATED"
        ;;
    esac
    ;;
  kubectl)
    if [[ "$*" == "config current-context" ]]; then
      printf '%s\n' "${MOCK_CURRENT_CONTEXT:-gke_weownai-proto_europe-west1_opencrane-dev}"
      exit 0
    fi
    if [[ "$*" == *" get crd/computeclasses.cloud.google.com"* ]]; then
      [[ "${MOCK_COMPUTE_CLASS_CRD_ABSENT:-0}" == "0" ]]
      exit
    fi
    if [[ "$*" == *" get computeclass/opencrane-database-proof"* ]]; then
      if [[ "${MOCK_FOREIGN_COMPUTE_CLASS:-0}" != "1" && ! -e "$MOCK_MUTATED" ]]; then
        exit 1
      fi
      case "$*" in
        *"managed-by}"*) printf '%s' "${MOCK_COMPUTE_CLASS_MANAGED_BY:-foreign-manager}" ;;
        *"prerequisite-profile}"*) printf '%s' "${MOCK_COMPUTE_CLASS_PROFILE:-foreign-profile}" ;;
        *"whenUnsatisfiable}"*) printf '%s' "${MOCK_COMPUTE_CLASS_SCALE_POLICY:-ScaleUpAnyway}" ;;
        *"bootDiskSize}"*) printf '%s' "${MOCK_COMPUTE_CLASS_BOOT_DISK_SIZE:-10}" ;;
        *"machineType}"*) printf '%s' "${MOCK_COMPUTE_CLASS_MACHINE_TYPE:-e2-small}" ;;
      esac
      exit
    fi
    if [[ "$*" == *" get namespace "* ]]; then
      if [[ "$*" != *" ${MOCK_FOREIGN_NAMESPACE:-__none__}"* ]]; then
        exit 1
      fi
      case "$*" in
        *"managed-by}"*) printf '%s' "${MOCK_NAMESPACE_MANAGED_BY:-}" ;;
        *"prerequisite-release}"*) printf '%s' "${MOCK_NAMESPACE_RELEASE:-}" ;;
      esac
      exit 0
    fi
    if [[ "$*" == *" create namespace "* && "$*" == *" --output=json"* ]]; then
      printf '{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"test"}}\n'
      exit 0
    fi
    if [[ "$*" == *" apply "* && "$*" == *" --filename=-"* ]]; then
      cat >/dev/null
      exit 0
    fi
    if [[ -n "${MOCK_OWNED_RESOURCE:-}" && "$*" == *" get ${MOCK_OWNED_RESOURCE}"* ]]; then
      case "$*" in
        *"managed-by}"*) printf 'Helm' ;;
        *"release-name}"*) printf '%s' "${MOCK_RESOURCE_RELEASE:-}" ;;
        *"release-namespace}"*) printf '%s' "${MOCK_RESOURCE_NAMESPACE:-}" ;;
        *"helm\\.sh/chart}"*) printf '%s' "${MOCK_RESOURCE_CHART:-}" ;;
      esac
      exit 0
    fi
    if [[ -n "${MOCK_FOREIGN_RESOURCE:-}" && "$*" == *" get ${MOCK_FOREIGN_RESOURCE}"* ]]; then
      exit 0
    fi
    if [[ "$*" == *" get service ingress-nginx-controller "* ]]; then
      printf '%s' "${MOCK_SERVICE_IP:-35.205.225.244}"
      exit 0
    fi
    if [[ "$*" == *" rollout status "* ]]; then
      [[ "${MOCK_ROLLOUT_FAIL:-0}" == "0" ]]
      exit
    fi
    if [[ "$*" == *" wait --for=condition=Established crd/"* ]]; then
      [[ "${MOCK_CRD_ESTABLISHED_FAIL:-0}" == "0" ]]
      exit
    fi
    if [[ "$*" == *" wait --for=condition=Health computeclass/opencrane-database-proof"* ]]; then
      [[ "${MOCK_COMPUTE_CLASS_HEALTH_FAIL:-0}" == "0" ]]
      exit
    fi
    if [[ "$*" == *" get ingressclass/nginx"* || "$*" == *" get crd/"* ]]; then
      [[ -e "$MOCK_MUTATED" ]]
      exit
    fi
    if [[ "$*" == *" get ingressclass nginx"* || "$*" == *" get crd "* ]]; then
      [[ -e "$MOCK_MUTATED" ]]
      exit
    fi
    if [[ "$*" == *" get "* ]]; then
      [[ -e "$MOCK_MUTATED" ]]
      exit
    fi
    ;;
  sleep)
    ;;
  shasum)
    archive=""
    for archive in "$@"; do :; done
    case "$(basename "$archive")" in
      ingress-nginx-4.15.1.tgz) digest='3eff0bd18151d6e6b1c441463410571443dda1ac78292cb189346628de784f0c' ;;
      cert-manager-v1.21.1.tgz) digest='c27101f3f3e2349fb4a9e704316105bf7b52ad73b8c8257d3498ef7f2f6a4adc' ;;
      cloudnative-pg-0.29.0.tgz) digest='668e065ff53508d58238788fd35b355a925060843629a951df0e6a9362e6d32f' ;;
      *) digest='invalid' ;;
    esac
    [[ "${MOCK_BAD_DIGEST:-0}" == "0" ]] || digest='invalid'
    printf '%s  %s\n' "$digest" "$archive"
    ;;
esac
MOCK
chmod +x "$MOCK_BIN/command-mock"
for command_name in gcloud helm kubectl shasum sleep; do
  ln -s "$MOCK_BIN/command-mock" "$MOCK_BIN/$command_name"
done

run_case()
{
  local case_name="$1"
  shift
  local calls="$TEST_DIR/$case_name.calls"
  local mutated="$TEST_DIR/$case_name.mutated"

  if ! env \
    PATH="$MOCK_BIN:$PATH" \
    MOCK_CALLS="$calls" \
    MOCK_MUTATED="$mutated" \
    "$@" \
    bash "$BOOTSTRAP" \
      --context gke_weownai-proto_europe-west1_opencrane-dev \
      --project-id weownai-proto \
      --region europe-west1 \
      --ingress-address-name weownai-dev-ingress \
      --yes >"$TEST_DIR/$case_name.output" 2>&1; then
    return 1
  fi
}

if ! run_case success; then
  cat "$TEST_DIR/success.output" >&2
  cat "$TEST_DIR/success.calls" >&2
  exit 1
fi
SUCCESS_CALLS="$TEST_DIR/success.calls"
grep -Fq 'helm list --deployed --failed --pending --uninstalled --superseded --uninstalling --namespace ingress-nginx' "$SUCCESS_CALLS"
! grep -Fq 'helm list --all ' "$SUCCESS_CALLS"
grep -Fq 'helm pull ingress-nginx --repo https://kubernetes.github.io/ingress-nginx --version 4.15.1' "$SUCCESS_CALLS"
grep -Fq 'helm pull cert-manager --repo https://charts.jetstack.io --version v1.21.1' "$SUCCESS_CALLS"
grep -Fq 'helm pull cloudnative-pg --repo https://cloudnative-pg.github.io/charts --version 0.29.0' "$SUCCESS_CALLS"
grep -Eq 'helm template ingress-nginx .*/ingress-nginx-4\.15\.1\.tgz --namespace ingress-nginx' "$SUCCESS_CALLS"
grep -Eq 'helm upgrade --install ingress-nginx .*/ingress-nginx-4\.15\.1\.tgz --namespace ingress-nginx' "$SUCCESS_CALLS"
grep -Fq -- '--set-string controller.service.loadBalancerIP=35.205.225.244' "$SUCCESS_CALLS"
grep -Fq -- '--atomic --wait --wait-for-jobs --timeout 20m' "$SUCCESS_CALLS"
grep -Fq 'kubectl --context gke_weownai-proto_europe-west1_opencrane-dev wait --for=condition=Established crd/subscriptions.postgresql.cnpg.io --timeout=2m' "$SUCCESS_CALLS"
grep -Eq 'kubectl --context gke_weownai-proto_europe-west1_opencrane-dev apply --server-side --field-manager=opencrane-prerequisite-bootstrap --filename=.*/database-proof-compute-class\.yaml' "$SUCCESS_CALLS"
grep -Fq 'kubectl --context gke_weownai-proto_europe-west1_opencrane-dev wait --for=condition=Health computeclass/opencrane-database-proof --timeout=2m' "$SUCCESS_CALLS"

if run_case context-mismatch MOCK_CURRENT_CONTEXT=other-context; then
  echo 'context mismatch unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/context-mismatch.calls"

if run_case address-mismatch MOCK_ADDRESS_REGION=europe-west4; then
  echo 'address-region mismatch unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/address-mismatch.calls"

if run_case foreign-resource MOCK_FOREIGN_NAMESPACE=cert-manager; then
  echo 'foreign namespace unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/foreign-resource.calls"

if run_case foreign-compute-class MOCK_FOREIGN_COMPUTE_CLASS=1; then
  echo 'foreign ComputeClass unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/foreign-compute-class.calls"

if run_case compute-class-disk-drift MOCK_COMPUTE_CLASS_BOOT_DISK_SIZE=20; then
  echo 'ComputeClass boot-disk drift unexpectedly succeeded' >&2
  exit 1
fi

if run_case compute-class-machine-drift MOCK_COMPUTE_CLASS_MACHINE_TYPE=e2-medium; then
  echo 'ComputeClass machine-type drift unexpectedly succeeded' >&2
  exit 1
fi

if run_case render-failure MOCK_RENDER_FAIL=1; then
  echo 'chart render failure unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/render-failure.calls"

if run_case digest-mismatch MOCK_BAD_DIGEST=1; then
  echo 'chart digest mismatch unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/digest-mismatch.calls"

if run_case wrong-chart \
  MOCK_RELEASE_EXISTS=ingress-nginx \
  MOCK_RELEASE_CHART=foreign-ingress-9.9.9; then
  echo 'same-name foreign Helm release unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/wrong-chart.calls"

if run_case rollout-failure MOCK_ROLLOUT_FAIL=1; then
  echo 'rollout failure unexpectedly succeeded' >&2
  exit 1
fi
grep -Eq 'helm upgrade --install cloudnative-pg .*/cloudnative-pg-0\.29\.0\.tgz' "$TEST_DIR/rollout-failure.calls"

if run_case crd-established-timeout MOCK_CRD_ESTABLISHED_FAIL=1; then
  echo 'CRD Established timeout unexpectedly succeeded' >&2
  exit 1
fi
grep -Fq 'kubectl --context gke_weownai-proto_europe-west1_opencrane-dev wait --for=condition=Established crd/challenges.acme.cert-manager.io --timeout=2m' "$TEST_DIR/crd-established-timeout.calls"

if ! run_case owned-namespace-retry \
  MOCK_FOREIGN_NAMESPACE=ingress-nginx \
  MOCK_NAMESPACE_MANAGED_BY=opencrane-prerequisite-bootstrap \
  MOCK_NAMESPACE_RELEASE=ingress-nginx \
  MOCK_OWNED_RESOURCE=ingressclass/nginx \
  MOCK_RESOURCE_RELEASE=ingress-nginx \
  MOCK_RESOURCE_NAMESPACE=ingress-nginx \
  MOCK_RESOURCE_CHART=ingress-nginx-4.15.1; then
  cat "$TEST_DIR/owned-namespace-retry.output" >&2
  cat "$TEST_DIR/owned-namespace-retry.calls" >&2
  exit 1
fi
grep -Eq 'helm upgrade --install ingress-nginx .*/ingress-nginx-4\.15\.1\.tgz' "$TEST_DIR/owned-namespace-retry.calls"

if ! run_case owned-cnpg-crd-retry \
  MOCK_FOREIGN_NAMESPACE=cnpg-system \
  MOCK_NAMESPACE_MANAGED_BY=opencrane-prerequisite-bootstrap \
  MOCK_NAMESPACE_RELEASE=cloudnative-pg \
  MOCK_OWNED_RESOURCE=crd/backups.postgresql.cnpg.io \
  MOCK_RESOURCE_RELEASE=cloudnative-pg \
  MOCK_RESOURCE_NAMESPACE=cnpg-system; then
  cat "$TEST_DIR/owned-cnpg-crd-retry.output" >&2
  exit 1
fi
grep -Eq 'helm upgrade --install cloudnative-pg .*/cloudnative-pg-0\.29\.0\.tgz' "$TEST_DIR/owned-cnpg-crd-retry.calls"

if run_case leftover-crd MOCK_FOREIGN_RESOURCE=crd/backups.postgresql.cnpg.io; then
  echo 'foreign non-representative CRD unexpectedly succeeded' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/leftover-crd.calls"

if run_case owned-namespace-foreign-crd \
  MOCK_FOREIGN_NAMESPACE=cnpg-system \
  MOCK_NAMESPACE_MANAGED_BY=opencrane-prerequisite-bootstrap \
  MOCK_NAMESPACE_RELEASE=cloudnative-pg \
  MOCK_FOREIGN_RESOURCE=crd/backups.postgresql.cnpg.io; then
  echo 'owned retry namespace masked a foreign CRD' >&2
  exit 1
fi
! grep -Fq 'helm upgrade' "$TEST_DIR/owned-namespace-foreign-crd.calls"

grep -Fq 'replicaCount: 1' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/prerequisites/gke-autopilot-dev/cert-manager.yaml"
grep -Fq 'namespace: cert-manager' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/prerequisites/gke-autopilot-dev/cert-manager.yaml"
grep -Fq 'podMonitorEnabled: false' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/prerequisites/gke-autopilot-dev/cloudnative-pg.yaml"
grep -Fq 'allowSnippetAnnotations: false' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/prerequisites/gke-autopilot-dev/ingress-nginx.yaml"

echo "bootstrap prerequisites contract: PASS"
