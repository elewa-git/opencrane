# -----------------------------------------------------------------------------
# OpenCrane GCP Infrastructure
#
# DEFAULT FLOW (plain-k8s on GKE): a single `terraform apply` provisions just a
# GKE cluster on the project's default VPC — nothing else required. You then
# install OpenCrane through apps/_infra/deploy-k8s. Custom VPC/NAT, Artifact Registry,
# and Cloud DNS are opt-in (see variables.tf).
#
# Easiest start — use platform/provision.sh so the regional, versioned GCS state
# backend is bootstrapped before this module is planned and applied.
# A manual init must supply that existing bucket and a per-cluster prefix:
#   terraform init \
#     -backend-config="bucket=YOUR_PROJECT-YOUR_CLUSTER-tfstate" \
#     -backend-config="prefix=clusters/YOUR_CLUSTER"
#   terraform apply -var project_id=YOUR_GCP_PROJECT -var cluster_name=YOUR_CLUSTER
#   eval "$(terraform output -raw kubeconfig_command)"
#   ../../deploy.sh --help  # then deploy through the owning silo entrypoint
# -----------------------------------------------------------------------------

data "google_client_config" "default" {}

# ---- Phase 1: Networking (OPT-IN) ----
#
# When enable_custom_vpc=false (default) GKE runs on the project default VPC and
# no networking resources are created.

module "networking" {
  source = "./modules/networking"
  count  = var.enable_custom_vpc ? 1 : 0

  project_id = var.project_id
  region     = var.region
  vpc_name   = var.vpc_name
}

# ---- Phase 2: GKE Cluster ----

module "gke" {
  source = "./modules/gke"

  project_id   = var.project_id
  region       = var.region
  cluster_name = var.cluster_name

  # Empty strings → the GKE module falls back to the project default VPC.
  vpc_id    = var.enable_custom_vpc ? module.networking[0].vpc_id : ""
  subnet_id = var.enable_custom_vpc ? module.networking[0].subnet_id : ""

  # Private nodes + Cloud NAT only make sense with a custom VPC.
  enable_private_nodes = var.enable_custom_vpc

  depends_on = [module.networking]
}

# Configure kubernetes and helm providers using GKE cluster credentials
provider "kubernetes" {
  host                   = "https://${module.gke.cluster_endpoint}"
  cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
  token                  = data.google_client_config.default.access_token
}

provider "helm" {
  kubernetes {
    host                   = "https://${module.gke.cluster_endpoint}"
    cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
    token                  = data.google_client_config.default.access_token
  }
}

# ---- Phase 3: Artifact Registry (OPT-IN) ----
#
# Default flow pushes images to an external registry (e.g. ghcr.io). Enable to
# provision a GCP Artifact Registry instead.

module "artifact_registry" {
  source = "./modules/artifact-registry"
  count  = var.enable_artifact_registry ? 1 : 0

  project_id    = var.project_id
  region        = var.region
  repository_id = "opencrane"
}

locals {
  registry_url = var.enable_artifact_registry ? module.artifact_registry[0].repository_url : var.registry_url
}

# ---- Phase 5: Cloud DNS (optional managed zone) ----
#
# Enable this to create the authoritative zone. Host records are an explicit operator
# responsibility after the ingress address is known.

module "dns" {
  source = "./modules/dns"
  count  = var.enable_cloud_dns ? 1 : 0

  project_id = var.project_id
  domain     = var.domain
}
