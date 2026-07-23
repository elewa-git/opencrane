variable "project_id"
{
  description = "GCP project ID"
  type        = string
}

variable "namespace"
{
  description = "Kubernetes namespace for the OpenCrane deployment"
  type        = string
  default     = "opencrane"
}

variable "release_name"
{
  description = "Helm release name"
  type        = string
  default     = "opencrane"
}

variable "registry_url"
{
  description = "Artifact Registry URL (region-docker.pkg.dev/project/repo)"
  type        = string
}

variable "image_tag"
{
  description = "Docker image tag for OpenCrane components"
  type        = string
  default     = "latest"
}

variable "domain"
{
  description = "Base domain for tenant subdomains"
  type        = string
}

# -- GCP extras (opt-in). When false (default) the deploy is plain-k8s on GKE:
#    standard PVC tenant storage, k8s Secrets, no GCS / Workload Identity / External
#    Secrets specialness. Flip to true to enable GCS-backed tenant storage.
variable "enable_gcs_storage"
{
  description = "Enable GCS-backed tenant storage (Workload Identity + GCS Fuse CSI). Plain k8s PVC storage when false."
  type        = bool
  default     = false
}

variable "bucket_prefix"
{
  description = "Bucket name prefix for GCS-backed tenant storage (only used when enable_gcs_storage=true)"
  type        = string
  default     = "opencrane"
}

variable "fleet_chart_path"
{
  # The fleet-operator/fleet-platform surface moved to the WeOwnAI repo (elewa-git/opencrane#150)
  # and no longer ships in this repo. Point this at a checked-out copy of WeOwnAI's
  # apps/fleet-platform chart (local path, or a `helm pull`-ed archive dir).
  description = "Path to the fleet-platform Helm chart (now maintained in the WeOwnAI repo)"
  type        = string
}

variable "database_secret_name"
{
  description = "Name of an existing Secret containing the fleet database URI. The database is provisioned separately through apps/postgres."
  type        = string

  validation
  {
    condition     = length(trimspace(var.database_secret_name)) > 0
    error_message = "database_secret_name is required; enable_app_deploy never creates or imports PostgreSQL."
  }
}

variable "database_secret_key"
{
  description = "Key in database_secret_name containing the fleet database URI."
  type        = string
  default     = "uri"

  validation
  {
    condition     = length(trimspace(var.database_secret_key)) > 0
    error_message = "database_secret_key must not be empty."
  }
}
