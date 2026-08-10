#!/usr/bin/env bash
set -euo pipefail

# Installs the shared Kubernetes substrate required by an OpenCrane silo. This is an
# explicit operator action: the per-silo release never owns cluster-wide controllers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$SCRIPT_DIR/values/prerequisites/gke-autopilot-dev"
source "$SCRIPT_DIR/prerequisite-chart-lock.sh"

EXPECTED_CONTEXT=""
PROJECT_ID=""
REGION="europe-west1"
INGRESS_ADDRESS_NAME=""
ASSUME_YES=0
INGRESS_ADDRESS_IP=""
CHART_CACHE_DIR=""
INGRESS_ARCHIVE=""
CERT_MANAGER_ARCHIVE=""
CNPG_ARCHIVE=""
DATABASE_PROOF_COMPUTE_CLASS="opencrane-database-proof"
DATABASE_PROOF_COMPUTE_CLASS_MANIFEST="$PROFILE_DIR/database-proof-compute-class.yaml"

log()
{
  printf '\033[0;36m[prerequisites]\033[0m %s\n' "$1"
}

fail()
{
  printf '\033[0;31m[prerequisites]\033[0m %s\n' "$1" >&2
  exit 1
}

usage()
{
  cat <<'USAGE'
Usage: bootstrap-prerequisites.sh \
  --context CONTEXT \
  --project-id PROJECT \
  --region REGION \
  --ingress-address-name NAME \
  [--yes]

Installs the pinned ingress-nginx, cert-manager, and CloudNativePG controllers
needed by an OpenCrane silo. The command fails closed when the target context,
regional static address, or existing cluster-wide resources do not match.
USAGE
}

parse_args()
{
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --context)
        [[ $# -ge 2 ]] || fail "--context needs a value"
        EXPECTED_CONTEXT="$2"
        shift 2
        ;;
      --project-id)
        [[ $# -ge 2 ]] || fail "--project-id needs a value"
        PROJECT_ID="$2"
        shift 2
        ;;
      --region)
        [[ $# -ge 2 ]] || fail "--region needs a value"
        REGION="$2"
        shift 2
        ;;
      --ingress-address-name)
        [[ $# -ge 2 ]] || fail "--ingress-address-name needs a value"
        INGRESS_ADDRESS_NAME="$2"
        shift 2
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$EXPECTED_CONTEXT" ]] || fail "--context is required"
  [[ -n "$PROJECT_ID" ]] || fail "--project-id is required"
  [[ -n "$REGION" ]] || fail "--region is required"
  [[ -n "$INGRESS_ADDRESS_NAME" ]] || fail "--ingress-address-name is required"
}

require_commands()
{
  local command_name
  for command_name in gcloud kubectl helm jq; do
    command -v "$command_name" >/dev/null 2>&1 || fail "missing required command: $command_name"
  done
}

validate_context()
{
  local current_context
  current_context="$(kubectl config current-context)"
  [[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail \
    "kubectl context is '$current_context', expected '$EXPECTED_CONTEXT'"

  kubectl --context "$EXPECTED_CONTEXT" version --request-timeout=15s >/dev/null
}

validate_ingress_address()
{
  local address_status address_type address_region

  INGRESS_ADDRESS_IP="$(gcloud compute addresses describe "$INGRESS_ADDRESS_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(address)')"
  address_status="$(gcloud compute addresses describe "$INGRESS_ADDRESS_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status)')"
  address_type="$(gcloud compute addresses describe "$INGRESS_ADDRESS_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(addressType)')"
  address_region="$(gcloud compute addresses describe "$INGRESS_ADDRESS_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(region)')"
  address_region="${address_region##*/}"

  [[ "$INGRESS_ADDRESS_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail \
    "regional address '$INGRESS_ADDRESS_NAME' did not return a valid IPv4 address"
  [[ "$address_type" == "EXTERNAL" ]] || fail \
    "regional address '$INGRESS_ADDRESS_NAME' is '$address_type', expected EXTERNAL"
  [[ "$address_region" == "$REGION" ]] || fail \
    "regional address '$INGRESS_ADDRESS_NAME' is in '$address_region', expected '$REGION'"
  [[ "$address_status" == "RESERVED" || "$address_status" == "IN_USE" ]] || fail \
    "regional address '$INGRESS_ADDRESS_NAME' has unsupported status '$address_status'"

  if [[ "$address_status" == "IN_USE" ]]; then
    helm_release_exists "$INGRESS_RELEASE" "$INGRESS_NAMESPACE" || fail \
      "regional address '$INGRESS_ADDRESS_NAME' is IN_USE without the expected ingress Helm release"
    local service_ip
    service_ip="$(kubectl --context "$EXPECTED_CONTEXT" \
      --namespace "$INGRESS_NAMESPACE" \
      get service ingress-nginx-controller \
      --output=jsonpath='{.status.loadBalancer.ingress[0].ip}')"
    [[ "$service_ip" == "$INGRESS_ADDRESS_IP" ]] || fail \
      "regional address '$INGRESS_ADDRESS_NAME' is IN_USE but the ingress Service reports '$service_ip'"
  fi
}

helm_release_exists()
{
  local release="$1" namespace="$2"
  [[ -n "$(helm_release_chart "$release" "$namespace")" ]]
}

helm_release_chart()
{
  local release="$1" namespace="$2"
  helm list \
    --deployed \
    --failed \
    --pending \
    --uninstalled \
    --superseded \
    --uninstalling \
    --namespace "$namespace" \
    --kube-context "$EXPECTED_CONTEXT" \
    --filter "^${release}$" \
    --output json \
    | jq -r --arg release "$release" '[.[] | select(.name == $release) | .chart][0] // ""'
}

resource_exists()
{
  kubectl --context "$EXPECTED_CONTEXT" get "$@" >/dev/null 2>&1
}

namespace_is_bootstrap_owned()
{
  local namespace="$1" release="$2"
  local managed_by owner_release
  managed_by="$(kubectl --context "$EXPECTED_CONTEXT" get namespace "$namespace" \
    --output=jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  owner_release="$(kubectl --context "$EXPECTED_CONTEXT" get namespace "$namespace" \
    --output=jsonpath='{.metadata.annotations.opencrane\.ai/prerequisite-release}')"
  [[ "$managed_by" == "opencrane-prerequisite-bootstrap" && "$owner_release" == "$release" ]]
}

resource_is_expected_helm_residue()
{
  local resource="$1" release="$2" namespace="$3" expected_chart="$4"
  local managed_by owner_release owner_namespace chart_identity
  managed_by="$(kubectl --context "$EXPECTED_CONTEXT" get "$resource" \
    --output=jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  owner_release="$(kubectl --context "$EXPECTED_CONTEXT" get "$resource" \
    --output=jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}')"
  owner_namespace="$(kubectl --context "$EXPECTED_CONTEXT" get "$resource" \
    --output=jsonpath='{.metadata.annotations.meta\.helm\.sh/release-namespace}')"
  chart_identity="$(kubectl --context "$EXPECTED_CONTEXT" get "$resource" \
    --output=jsonpath='{.metadata.labels.helm\.sh/chart}')"
  [[ "$managed_by" == "Helm" \
    && "$owner_release" == "$release" \
    && "$owner_namespace" == "$namespace" \
    && ( -z "$chart_identity" || "$chart_identity" == "$expected_chart" ) ]]
}

assert_absent_release_is_clean()
{
  local release="$1" namespace="$2" expected_chart="$3"
  shift 3

  local actual_chart
  actual_chart="$(helm_release_chart "$release" "$namespace")"
  if [[ -n "$actual_chart" ]]; then
    [[ "$actual_chart" == "$expected_chart" ]] || fail \
      "Helm release '$release' owns chart '$actual_chart', expected '$expected_chart'; refusing to adopt it"
    return
  fi

  local retry_namespace=0
  if resource_exists namespace "$namespace"; then
    namespace_is_bootstrap_owned "$namespace" "$release" || fail \
      "namespace '$namespace' exists without Helm release '$release' or its bootstrap ownership markers; refusing to adopt it"
    retry_namespace=1
  fi

  local resource
  for resource in "$@"; do
    if resource_exists "$resource"; then
      if [[ "$retry_namespace" == "1" ]] \
        && resource_is_expected_helm_residue "$resource" "$release" "$namespace" "$expected_chart"; then
        continue
      fi
      fail "resource '$resource' exists without exact Helm ownership for release '$release'; refusing to adopt it"
    fi
  done
}

validate_existing_ownership()
{
  assert_absent_release_is_clean \
    "$INGRESS_RELEASE" \
    "$INGRESS_NAMESPACE" \
    "${INGRESS_CHART}-${INGRESS_VERSION}" \
    "${INGRESS_CLUSTER_RESOURCES[@]}"
  assert_absent_release_is_clean \
    "$CERT_MANAGER_RELEASE" \
    "$CERT_MANAGER_NAMESPACE" \
    "${CERT_MANAGER_CHART}-${CERT_MANAGER_VERSION}" \
    "${CERT_MANAGER_CLUSTER_RESOURCES[@]}"
  assert_absent_release_is_clean \
    "$CNPG_RELEASE" \
    "$CNPG_NAMESPACE" \
    "${CNPG_CHART}-${CNPG_VERSION}" \
    "${CNPG_CLUSTER_RESOURCES[@]}"
}

database_proof_compute_class_is_bootstrap_owned()
{
  local managed_by profile
  managed_by="$(kubectl --context "$EXPECTED_CONTEXT" get "computeclass/$DATABASE_PROOF_COMPUTE_CLASS" \
    --output=jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  profile="$(kubectl --context "$EXPECTED_CONTEXT" get "computeclass/$DATABASE_PROOF_COMPUTE_CLASS" \
    --output=jsonpath='{.metadata.annotations.opencrane\.ai/prerequisite-profile}')"
  [[ "$managed_by" == "opencrane-prerequisite-bootstrap" && "$profile" == "gke-autopilot-dev" ]]
}

validate_database_proof_compute_class()
{
  [[ -f "$DATABASE_PROOF_COMPUTE_CLASS_MANIFEST" ]] || fail \
    "database proof ComputeClass manifest is missing: $DATABASE_PROOF_COMPUTE_CLASS_MANIFEST"
  resource_exists "crd/computeclasses.cloud.google.com" || fail \
    "GKE ComputeClass CRD is absent; the gke-autopilot-dev profile requires computeclasses.cloud.google.com"
  if resource_exists "computeclass/$DATABASE_PROOF_COMPUTE_CLASS"; then
    database_proof_compute_class_is_bootstrap_owned || fail \
      "ComputeClass '$DATABASE_PROOF_COMPUTE_CLASS' exists without OpenCrane bootstrap ownership; refusing to adopt it"
  fi
}

sha256_file()
{
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$path" | awk '{print $NF}'
  else
    fail "one of shasum, sha256sum, or openssl is required to verify chart archives"
  fi
}

pull_chart()
{
  local chart="$1" repository="$2" version="$3" expected_sha256="$4"
  local archive="$CHART_CACHE_DIR/${chart}-${version}.tgz"

  helm pull "$chart" \
    --repo "$repository" \
    --version "$version" \
    --destination "$CHART_CACHE_DIR"
  local actual_sha256
  actual_sha256="$(sha256_file "$archive")"
  [[ "$actual_sha256" == "$expected_sha256" ]] || fail \
    "chart '$chart' $version has SHA-256 '$actual_sha256', expected '$expected_sha256'"
  printf '%s' "$archive"
}

prepare_chart_archives()
{
  CHART_CACHE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-prerequisite-charts.XXXXXX")"
  trap 'rm -rf -- "$CHART_CACHE_DIR"' EXIT
  INGRESS_ARCHIVE="$(pull_chart "$INGRESS_CHART" "$INGRESS_REPOSITORY" "$INGRESS_VERSION" "$INGRESS_ARCHIVE_SHA256")"
  CERT_MANAGER_ARCHIVE="$(pull_chart "$CERT_MANAGER_CHART" "$CERT_MANAGER_REPOSITORY" "$CERT_MANAGER_VERSION" "$CERT_MANAGER_ARCHIVE_SHA256")"
  CNPG_ARCHIVE="$(pull_chart "$CNPG_CHART" "$CNPG_REPOSITORY" "$CNPG_VERSION" "$CNPG_ARCHIVE_SHA256")"
}

render_pinned_charts()
{
  log "rendering the three pinned controller charts before mutation..."
  prepare_chart_archives
  helm template "$INGRESS_RELEASE" "$INGRESS_ARCHIVE" \
    --namespace "$INGRESS_NAMESPACE" \
    --include-crds \
    --values "$PROFILE_DIR/ingress-nginx.yaml" \
    --set-string "controller.service.loadBalancerIP=$INGRESS_ADDRESS_IP" >/dev/null
  helm template "$CERT_MANAGER_RELEASE" "$CERT_MANAGER_ARCHIVE" \
    --namespace "$CERT_MANAGER_NAMESPACE" \
    --include-crds \
    --values "$PROFILE_DIR/cert-manager.yaml" >/dev/null
  helm template "$CNPG_RELEASE" "$CNPG_ARCHIVE" \
    --namespace "$CNPG_NAMESPACE" \
    --include-crds \
    --values "$PROFILE_DIR/cloudnative-pg.yaml" >/dev/null
}

confirm_mutation()
{
  if [[ "$ASSUME_YES" == "1" ]]; then
    return
  fi
  [[ -t 0 ]] || fail "non-interactive execution requires --yes"

  local answer
  read -rp "Install shared controllers into '$EXPECTED_CONTEXT' using $INGRESS_ADDRESS_IP? [y/N]: " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "aborted"
}

install_release()
{
  local release="$1" archive="$2" namespace="$3" profile="$4"
  shift 4

  helm upgrade --install "$release" "$archive" \
    --namespace "$namespace" \
    --kube-context "$EXPECTED_CONTEXT" \
    --values "$profile" \
    --atomic \
    --wait \
    --wait-for-jobs \
    --timeout 20m \
    "$@"
}

ensure_bootstrap_namespace()
{
  local namespace="$1" release="$2"
  kubectl --context "$EXPECTED_CONTEXT" create namespace "$namespace" \
    --dry-run=client \
    --output=json \
    | jq \
        --arg release "$release" \
        '.metadata.labels["app.kubernetes.io/managed-by"] = "opencrane-prerequisite-bootstrap"
          | .metadata.annotations["opencrane.ai/prerequisite-release"] = $release' \
    | kubectl --context "$EXPECTED_CONTEXT" apply \
        --server-side \
        --field-manager=opencrane-prerequisite-bootstrap \
        --filename=- >/dev/null
}

install_prerequisites()
{
  log "installing ingress-nginx $INGRESS_VERSION..."
  ensure_bootstrap_namespace "$INGRESS_NAMESPACE" "$INGRESS_RELEASE"
  install_release \
    "$INGRESS_RELEASE" \
    "$INGRESS_ARCHIVE" \
    "$INGRESS_NAMESPACE" \
    "$PROFILE_DIR/ingress-nginx.yaml" \
    --set-string "controller.service.loadBalancerIP=$INGRESS_ADDRESS_IP"

  log "installing cert-manager $CERT_MANAGER_VERSION..."
  ensure_bootstrap_namespace "$CERT_MANAGER_NAMESPACE" "$CERT_MANAGER_RELEASE"
  install_release \
    "$CERT_MANAGER_RELEASE" \
    "$CERT_MANAGER_ARCHIVE" \
    "$CERT_MANAGER_NAMESPACE" \
    "$PROFILE_DIR/cert-manager.yaml"

  log "installing CloudNativePG $CNPG_VERSION..."
  ensure_bootstrap_namespace "$CNPG_NAMESPACE" "$CNPG_RELEASE"
  install_release \
    "$CNPG_RELEASE" \
    "$CNPG_ARCHIVE" \
    "$CNPG_NAMESPACE" \
    "$PROFILE_DIR/cloudnative-pg.yaml"

  log "applying GKE Autopilot database-proof ComputeClass..."
  kubectl --context "$EXPECTED_CONTEXT" apply \
    --server-side \
    --field-manager=opencrane-prerequisite-bootstrap \
    --filename="$DATABASE_PROOF_COMPUTE_CLASS_MANIFEST" >/dev/null
}

wait_for_ingress_address()
{
  local actual_ip="" attempt
  for ((attempt = 1; attempt <= 60; attempt++)); do
    actual_ip="$(kubectl --context "$EXPECTED_CONTEXT" \
      --namespace "$INGRESS_NAMESPACE" \
      get service ingress-nginx-controller \
      --output=jsonpath='{.status.loadBalancer.ingress[0].ip}')"
    if [[ "$actual_ip" == "$INGRESS_ADDRESS_IP" ]]; then
      return
    fi
    sleep 5
  done
  fail "ingress Service has '$actual_ip', expected reserved address '$INGRESS_ADDRESS_IP'"
}

wait_for_established_crds()
{
  local resource
  for resource in "$@"; do
    if [[ "$resource" == crd/* ]]; then
      kubectl --context "$EXPECTED_CONTEXT" wait \
        --for=condition=Established "$resource" --timeout=2m
    fi
  done
}

verify_prerequisites()
{
  log "verifying controller rollouts and public contracts..."
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$INGRESS_NAMESPACE" \
    rollout status deployment/ingress-nginx-controller --timeout=5m
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$CERT_MANAGER_NAMESPACE" \
    rollout status deployment/cert-manager --timeout=5m
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$CERT_MANAGER_NAMESPACE" \
    rollout status deployment/cert-manager-webhook --timeout=5m
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$CERT_MANAGER_NAMESPACE" \
    rollout status deployment/cert-manager-cainjector --timeout=5m
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$CNPG_NAMESPACE" \
    rollout status deployment/cloudnative-pg --timeout=5m

  kubectl --context "$EXPECTED_CONTEXT" get ingressclass nginx >/dev/null
  wait_for_established_crds "${CERT_MANAGER_CLUSTER_RESOURCES[@]}"
  wait_for_established_crds "${CNPG_CLUSTER_RESOURCES[@]}"
  kubectl --context "$EXPECTED_CONTEXT" wait \
    --for=condition=Health "computeclass/$DATABASE_PROOF_COMPUTE_CLASS" --timeout=2m || fail \
    "ComputeClass '$DATABASE_PROOF_COMPUTE_CLASS' did not reach Health=True; inspect CrdMisconfigured"
  local compute_class_json
  compute_class_json="$(kubectl --context "$EXPECTED_CONTEXT" get \
    "computeclass/$DATABASE_PROOF_COMPUTE_CLASS" --output=json)"
  jq -e '(any(.status.conditions[]?; .type == "Health" and .status == "True"))
    and (all(.status.conditions[]?; .type != "CrdMisconfigured" or .status != "True"))
    and (.spec.autopilot.enabled == true) and (.spec.whenUnsatisfiable == "ScaleUpAnyway")
    and (.spec.priorities == [{"podFamily":"general-purpose"}])' \
    <<<"$compute_class_json" >/dev/null || fail \
    "ComputeClass '$DATABASE_PROOF_COMPUTE_CLASS' does not match its healthy Autopilot database-proof contract"
  wait_for_ingress_address

  log "shared prerequisites are ready; ingress address: $INGRESS_ADDRESS_IP"
}

main()
{
  parse_args "$@"
  require_commands
  validate_context
  validate_ingress_address
  validate_existing_ownership
  validate_database_proof_compute_class
  render_pinned_charts
  confirm_mutation
  install_prerequisites
  verify_prerequisites
}

main "$@"
