# -----------------------------------------------------------------------------
# Root variables for OpenCrane GCP infrastructure
# -----------------------------------------------------------------------------

variable "project_id"
{
  description = "GCP project ID"
  type        = string
}

variable "region"
{
  description = "GCP region for all resources"
  type        = string
  default     = "europe-west1"
}

variable "environment"
{
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# Networking
#
# By default the GKE cluster runs on the project's existing `default` VPC, so a
# bare apply needs no custom networking. Set enable_custom_vpc=true to provision
# a dedicated VPC + subnet + Cloud Router + Cloud NAT (e.g. for private nodes).
variable "enable_custom_vpc"
{
  description = "Provision a dedicated VPC + subnet + Cloud NAT. When false, GKE uses the project default VPC."
  type        = bool
  default     = false
}

variable "vpc_name"
{
  description = "Name for the VPC network (only used when enable_custom_vpc=true)"
  type        = string
  default     = "opencrane-vpc"
}

# Cloud DNS is optional. By default the deploy prints the ingress IP and you set
# DNS manually at your registrar. Set enable_cloud_dns=true to have Terraform create
# the managed zone, the install-time platform records (apex, *.<base>, opencrane-ui
# host), and the shared roles/dns.admin Workload-Identity binding. Per-org records are
# reconciled at runtime by external-dns from the operator's DNSEndpoint CRs.
variable "enable_cloud_dns"
{
  description = "Create the Cloud DNS zone, install-time platform records, and the shared roles/dns.admin Workload-Identity binding for external-dns + cert-manager DNS-01. Per-org records are reconciled at runtime by external-dns."
  type        = bool
  default     = false
}

# Artifact Registry is optional. By default images are expected on an external
# registry (e.g. ghcr.io). Set enable_artifact_registry=true to provision a GCP
# Artifact Registry and push images there.
variable "enable_artifact_registry"
{
  description = "Provision a GCP Artifact Registry repository for OpenCrane images."
  type        = bool
  default     = false
}

# Container registry base URL used for image references when Artifact Registry is
# disabled. Defaults to the public ghcr.io OpenCrane org.
variable "registry_url"
{
  description = "Registry base URL for OpenCrane images when enable_artifact_registry=false (e.g. ghcr.io/elewa-git)."
  type        = string
  default     = "ghcr.io/elewa-git"
}

# Enable GCS-backed tenant storage (Workload Identity + GCS Fuse). When false
# (default) tenant storage uses standard k8s PVCs, keeping the deploy plain-k8s.
variable "enable_gcs_storage"
{
  description = "Enable GCS-backed tenant storage extras. Plain k8s PVC storage when false."
  type        = bool
  default     = false
}

# Install the OpenCrane Helm chart with Terraform. When false (default), Terraform
# provisions the cluster ONLY — so a single `terraform apply` always succeeds (no
# provider bootstrap problem) and you install the app afterwards with the standard
# `helm install` (k8s-native). Set true to also deploy the chart via Terraform; the
# guided deploy.sh handles the required two-step bootstrap automatically.
variable "enable_app_deploy"
{
  description = "Also install the OpenCrane Helm chart via Terraform. When false (default), Terraform creates the cluster only — run `helm install` afterwards."
  type        = bool
  default     = false
}

variable "fleet_chart_path"
{
  # The fleet-operator/fleet-platform surface moved to the WeOwnAI repo (elewa-git/opencrane#150)
  # and no longer ships in this repo. Required only when enable_app_deploy=true — point it at a
  # checked-out copy of WeOwnAI's apps/fleet-platform chart.
  description = "Path to the fleet-platform Helm chart (now maintained in the WeOwnAI repo). Required when enable_app_deploy=true."
  type        = string
  default     = ""
}

variable "app_database_secret_name"
{
  description = "Existing Kubernetes Secret containing the fleet database URI. Required when enable_app_deploy=true; Terraform never creates or imports the database."
  type        = string
  default     = ""
}

variable "app_database_secret_key"
{
  description = "Key in app_database_secret_name containing the fleet database URI."
  type        = string
  default     = "uri"
}

# GKE
variable "cluster_name"
{
  description = "Name for the GKE cluster"
  type        = string
  default     = "opencrane-cluster"
}

# Domain & DNS. Optional — bring the cluster up first and wire DNS later. Used for
# ingress hostnames and, when enable_cloud_dns=true, the managed DNS records.
variable "domain"
{
  description = "Base domain for tenant subdomains (e.g. opencrane.example.com). Optional."
  type        = string
  default     = ""
}

# Container images
variable "image_tag"
{
  description = "Docker image tag for OpenCrane components"
  type        = string
  default     = "latest"
}
