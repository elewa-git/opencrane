#!/usr/bin/env bash
# =============================================================================
# OpenCrane — shared cluster provisioning (sourced by the deploy scripts)
#
# `--provision <local|gke|vps>` on a deploy script creates + targets a cluster BEFORE it
# installs OpenCrane, so one command goes from nothing → a running platform. Without
# --provision, the deploy runs against the current kubectl context (an existing cluster).
#
# This replaces the standalone install.sh / gke-deploy.sh / vps-deploy.sh — provisioning is
# now a capability of the multi-tenant + single-tenant deploy scripts, not separate installers.
#
#   _provision_cluster <local|gke|vps> [--project-id ID] [--region R] [--cluster NAME] [--yes]
#
# On return the kube context points at the new cluster, and PROVISION_DEPLOY_SET holds any
# target-specific deploy flags the caller should append (e.g. k3s ships its own ingress).
# =============================================================================

# Target-specific deploy flags the caller appends to its profile (e.g. k3s → traefik).
PROVISION_DEPLOY_SET=()

_provision_log() { echo -e "\033[0;36m[provision]\033[0m $1"; }
_provision_err() { echo -e "\033[0;31m[provision]\033[0m $1" >&2; }

# Create the cluster for TARGET + point the kube context at it.
_provision_cluster() {
  local target="$1"; shift
  local project="" region="europe-west1" cluster="" yes=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-id) project="$2"; shift 2 ;;
      --region)     region="$2"; shift 2 ;;
      --cluster)    cluster="$2"; shift 2 ;;
      --yes)        yes=1; shift ;;
      *)            shift ;;  # ignore non-provisioner flags
    esac
  done
  case "$target" in
    local) _provision_local "${cluster:-opencrane-local}" ;;
    gke)   _provision_gke "$project" "$region" "${cluster:-opencrane-cluster}" "$yes" ;;
    vps)   _provision_vps ;;
    *)     _provision_err "unknown --provision target '$target' (use local|gke|vps)"; return 1 ;;
  esac
}

# local: a k3d cluster on this machine (laptop/dev). k3d writes + selects the kube context.
_provision_local() {
  local name="$1"
  command -v k3d >/dev/null 2>&1 || { _provision_err "k3d not found — install it: https://k3d.io"; return 1; }
  _provision_log "creating local k3d cluster '$name'…"
  k3d cluster delete "$name" >/dev/null 2>&1 || true
  k3d cluster create "$name" --agents 1
}

# gke: a GKE Autopilot cluster via Terraform (cluster only), then point kubectl at it.
# BASE_DOMAIN (a global in the calling deploy script) threads into the Cloud DNS zone var.
_provision_gke() {
  local project="$1" region="$2" cluster="$3" yes="$4"
  local tf_dir; tf_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/terraform"
  local state_bucket="${OPENCRANE_TERRAFORM_STATE_BUCKET:-${project}-${cluster}-tfstate}"
  local c; for c in gcloud terraform kubectl; do command -v "$c" >/dev/null 2>&1 || { _provision_err "missing required command: $c"; return 1; }; done
  if [[ -z "$project" && -t 0 ]]; then read -rp "GCP Project ID: " project; fi
  [[ -n "$project" ]] || { _provision_err "gke provisioning needs --project-id"; return 1; }
  state_bucket="${OPENCRANE_TERRAFORM_STATE_BUCKET:-${project}-${cluster}-tfstate}"
  if [[ ! "$state_bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]; then
    _provision_err "Terraform state bucket '$state_bucket' is not a valid 3-63 character GCS bucket name. Set OPENCRANE_TERRAFORM_STATE_BUCKET explicitly."
    return 1
  fi
  if [[ "$yes" != "1" && -t 0 ]]; then
    read -rp "Provision GKE cluster '$cluster' in $project/$region? [Y/n]: " c; [[ "${c:-Y}" =~ ^[Yy]$ ]] || { _provision_err "aborted."; return 1; }
  fi
  _provision_log "validating the checked-in Terraform configuration…"
  terraform -chdir="$tf_dir" fmt -check -recursive
  _provision_log "enabling GCP APIs (container, compute, Cloud KMS, Cloud Storage)…"
  # The Terraform module enables CMEK-backed Kubernetes Secret encryption by default, so
  # Cloud KMS is a required baseline API rather than an optional deployment extra.
  gcloud services enable \
    container.googleapis.com \
    compute.googleapis.com \
    cloudkms.googleapis.com \
    storage.googleapis.com \
    --project "$project" \
    --quiet
  if ! gcloud storage buckets describe "gs://$state_bucket" --project "$project" >/dev/null 2>&1; then
    _provision_log "creating regional Terraform state bucket 'gs://$state_bucket'…"
    gcloud storage buckets create "gs://$state_bucket" \
      --project "$project" \
      --location "$region" \
      --uniform-bucket-level-access \
      --public-access-prevention
  fi
  local state_location
  state_location="$(gcloud storage buckets describe "gs://$state_bucket" --project "$project" --format='value(location)')"
  if [[ "${state_location,,}" != "${region,,}" ]]; then
    _provision_err "Terraform state bucket 'gs://$state_bucket' is in '$state_location', not required region '$region'."
    return 1
  fi
  gcloud storage buckets update "gs://$state_bucket" \
    --project "$project" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --versioning
  terraform -chdir="$tf_dir" init \
    -input=false \
    -lockfile=readonly \
    -reconfigure \
    -backend-config="bucket=$state_bucket" \
    -backend-config="prefix=clusters/$cluster"
  terraform -chdir="$tf_dir" validate
  _provision_log "provisioning the GKE cluster with Terraform…"
  terraform -chdir="$tf_dir" apply -input=false -auto-approve \
    -var "project_id=$project" -var "region=$region" -var "cluster_name=$cluster" \
    ${BASE_DOMAIN:+-var "domain=$BASE_DOMAIN"}
  _provision_log "fetching cluster credentials…"
  gcloud container clusters get-credentials "$cluster" --region "$region" --project "$project"
}

# vps: a one-node k3s cluster on THIS Linux host. k3s ships traefik + local-path SC, so the
# caller deploys against those.
_provision_vps() {
  [[ "$(uname -s)" == "Linux" ]] || { _provision_err "vps (k3s) needs Linux; on a laptop use --provision local"; return 1; }
  command -v helm >/dev/null 2>&1 || { _provision_err "missing required command: helm"; return 1; }
  if ! command -v k3s >/dev/null 2>&1; then _provision_log "installing k3s…"; curl -sfL https://get.k3s.io | sh -; fi
  export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
  local i; for i in {1..30}; do [[ -r "$KUBECONFIG" ]] && break; sleep 2; done
  [[ -r "$KUBECONFIG" ]] || { _provision_err "cannot read $KUBECONFIG (run with sudo, or set KUBECONFIG)"; return 1; }
  PROVISION_DEPLOY_SET=(--set "ingress.className=traefik" --set "networkPolicy.ingressNamespace=kube-system")
}
