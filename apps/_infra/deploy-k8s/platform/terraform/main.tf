# -----------------------------------------------------------------------------
# OpenCrane GCP Infrastructure
#
# DEFAULT FLOW (plain-k8s on GKE): a single `terraform apply` provisions just a
# GKE cluster on the project's default VPC — nothing else required. You then
# install OpenCrane the standard way: the per-role charts (the fleet-platform chart, now in
# the WeOwnAI repo per elewa-git/opencrane#150, and apps/_infra/deploy-k8s here).
# Custom VPC/NAT, Artifact Registry, Cloud DNS, GCS-backed storage, and even
# installing the Helm chart via Terraform (enable_app_deploy) are all OPT-IN
# (see variables.tf).
#
# Easiest start — only the project id is required:
#   cd platform/terraform
#   terraform init
#   terraform apply -var project_id=YOUR_GCP_PROJECT
#   eval "$(terraform output -raw kubeconfig_command)"
#   helm install opencrane ../helm --set ingress.domain=YOUR_DOMAIN
# -----------------------------------------------------------------------------

data "google_client_config" "default" {}

# ---- Phase 1: Networking (OPT-IN) ----
#
# When enable_custom_vpc=false (default) GKE runs on the project default VPC and
# no networking resources are created.

module "networking"
{
  source = "./modules/networking"
  count  = var.enable_custom_vpc ? 1 : 0

  project_id = var.project_id
  region     = var.region
  vpc_name   = var.vpc_name
}

# ---- Phase 2: GKE Cluster ----

module "gke"
{
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
provider "kubernetes"
{
  host                   = "https://${module.gke.cluster_endpoint}"
  cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
  token                  = data.google_client_config.default.access_token
}

provider "helm"
{
  kubernetes
  {
    host                   = "https://${module.gke.cluster_endpoint}"
    cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
    token                  = data.google_client_config.default.access_token
  }
}

# ---- Phase 3: Artifact Registry (OPT-IN) ----
#
# Default flow pushes images to an external registry (e.g. ghcr.io). Enable to
# provision a GCP Artifact Registry instead.

module "artifact_registry"
{
  source = "./modules/artifact-registry"
  count  = var.enable_artifact_registry ? 1 : 0

  project_id    = var.project_id
  region        = var.region
  repository_id = "opencrane"
}

locals
{
  registry_url = var.enable_artifact_registry ? module.artifact_registry[0].repository_url : var.registry_url
}

# ---- Phase 4: Application (OPT-IN: OpenCrane only) ----
#
# Disabled by default so a bare `terraform apply` provisions only the cluster and
# never has to bootstrap the kubernetes/helm providers from a cluster created in
# the same run. Install the app afterwards with `helm install` (recommended), or
# set enable_app_deploy=true to have Terraform install the chart too.

module "app_deploy"
{
  source = "./modules/app-deploy"
  count  = var.enable_app_deploy ? 1 : 0

  project_id         = var.project_id
  registry_url       = local.registry_url
  image_tag          = var.image_tag
  domain             = var.domain
  namespace          = "opencrane"
  enable_gcs_storage = var.enable_gcs_storage
  fleet_chart_path   = var.fleet_chart_path
  database_secret_name = var.app_database_secret_name
  database_secret_key  = var.app_database_secret_key

  depends_on = [module.gke]
}

# ---- Phase 5: Cloud DNS (OPT-IN: zone + platform records + shared DNS-writer WI) ----
#
# Default flow prints the ingress IP and you point DNS at it manually. Enable to have
# Terraform manage the Cloud DNS zone, the install-time platform records (apex, `*.<base>`,
# opencrane-ui host), and the shared `roles/dns.admin` Workload-Identity binding that BOTH
# external-dns and the cert-manager DNS-01 solver impersonate. Per-org/per-host records are
# NOT written here — external-dns reconciles them at runtime from the operator's DNSEndpoint
# CRs.

module "dns"
{
  source = "./modules/dns"
  # Gated on enable_cloud_dns ALONE: the zone + the shared DNS-writer identity have no
  # dependency on the running app, so they provision in a cluster-only flow (enabling
  # cert-manager DNS-01 to issue off `--dns-writer-gsa $(terraform output …)`). The
  # platform A-records DO need the ingress IP — they are gated inside the module on
  # `ingress_ip`, which is null (→ skipped) until the app is deployed by Terraform.
  count = var.enable_cloud_dns ? 1 : 0

  project_id = var.project_id
  domain     = var.domain
  # null when the app is not deployed by Terraform → the module's "" default → records skipped.
  ingress_ip = one(module.app_deploy[*].ingress_ip)

  depends_on = [module.app_deploy]
}
