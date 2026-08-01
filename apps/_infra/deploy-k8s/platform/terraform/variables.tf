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

# Cloud DNS is optional. Enable it to create the authoritative zone; host records remain
# an explicit operation after the ingress address is known.
variable "enable_cloud_dns"
{
  description = "Create the authoritative Cloud DNS zone."
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
