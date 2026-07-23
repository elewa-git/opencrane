# -----------------------------------------------------------------------------
# OpenCrane — Cloud-Agnostic Core
#
# Applies to ANY Kubernetes cluster: on-prem, GKE, AKS, EKS, k3d.
# Does NOT provision cloud infrastructure. Assumes a kubeconfig is already
# pointed at the target cluster.
#
# Usage:
#   cd platform/terraform/core
#   terraform init
#   terraform apply
#
# For cloud installs, run cloud/<provider>/main.tf FIRST to provision the
# cluster and managed services, then apply this module on the resulting cluster.
# -----------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"

  required_providers
  {
    helm =
    {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }

    kubernetes =
    {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }
}

variable "image_tag"
{
  description = "Docker image tag for OpenCrane components"
  type        = string
  default     = "latest"
}

variable "namespace"
{
  description = "Kubernetes namespace to deploy OpenCrane into"
  type        = string
  default     = "opencrane"
}

variable "helm_values_file"
{
  description = "Path to a Helm values override file (e.g. values/gcp.yaml for GCP installs)"
  type        = string
  default     = ""
}

variable "fleet_chart_path"
{
  # The fleet-operator/fleet-platform surface moved to the WeOwnAI repo (elewa-git/opencrane#150)
  # and no longer ships in this repo. Point this at a checked-out copy of WeOwnAI's
  # apps/fleet-platform chart (local path, or a `helm pull`-ed archive dir).
  description = "Path to the fleet-platform Helm chart (now maintained in the WeOwnAI repo)"
  type        = string
}

resource "kubernetes_namespace" "opencrane"
{
  metadata
  {
    name = var.namespace
  }
}

resource "helm_release" "opencrane"
{
  name       = "opencrane"
  # Chart split (Option 2): terraform provisions the cluster + the once-per-cluster FLEET chart
  # (bootstrap + fleet-manager). Per-org SILO charts (apps/_infra/deploy-k8s) are deployed
  # DYNAMICALLY out-of-band (apps/_infra/deploy-k8s/deploy.sh today; the fleet operator auto-stamps them in S2),
  # so they are intentionally NOT a static terraform release.
  # The fleet-platform chart itself moved to the WeOwnAI repo (elewa-git/opencrane#150); pass its
  # local path via var.fleet_chart_path.
  chart      = var.fleet_chart_path
  namespace  = kubernetes_namespace.opencrane.metadata[0].name
  wait       = true
  timeout    = 600

  # This release is the FLEET chart (chart-split / rename); the per-silo image is set by the
  # silo chart's own deploy, not here.
  set
  {
    name  = "fleetManager.image.tag"
    value = var.image_tag
  }

  dynamic "values"
  {
    for_each = var.helm_values_file != "" ? [var.helm_values_file] : []
    content
    {
      content = file(values.value)
    }
  }
}
