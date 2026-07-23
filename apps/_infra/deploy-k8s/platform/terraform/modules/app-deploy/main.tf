# -----------------------------------------------------------------------------
# App Deploy module
#
# Deploys the OpenCrane Helm chart onto an already prepared cluster.
# PostgreSQL and its credentials are app-owned and installed separately through
# apps/postgres; Terraform deliberately has no duplicate database authority.
# -----------------------------------------------------------------------------

# ---- Static ingress IP (reserved so DNS can point to it) ----

resource "google_compute_global_address" "ingress_ip"
{
  name    = "${var.release_name}-ingress-ip"
  project = var.project_id
}

# ---- cert-manager via Helm chart (CONN.8) ----

resource "helm_release" "cert_manager"
{
  name             = "cert-manager"
  namespace        = "cert-manager"
  create_namespace = true
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.15.1"
  wait             = true
  timeout          = 600

  set
  {
    name  = "crds.enabled"
    value = "true"
  }
}

# ---- OpenCrane Helm chart ----

resource "helm_release" "opencrane"
{
  name             = var.release_name
  namespace        = var.namespace
  create_namespace = true
  # Chart split (Option 2): the once-per-cluster FLEET chart (bootstrap + fleet-manager).
  # Per-org SILO charts deploy dynamically out-of-band, not as a static terraform release.
  # The fleet-platform chart itself moved to the WeOwnAI repo (elewa-git/opencrane#150); pass its
  # local path via var.fleet_chart_path.
  chart            = var.fleet_chart_path
  wait             = true
  timeout          = 600

  # Fleet-manager image (this release is the FLEET chart, chart-split / rename). The per-silo
  # clustertenant-manager image is set by the silo chart's own deploy, not here.
  set
  {
    name  = "fleetManager.image.repository"
    value = "${var.registry_url}/fleet-manager"
  }

  set
  {
    name  = "fleetManager.image.tag"
    value = var.image_tag
  }

  set
  {
    name  = "fleetManager.image.pullPolicy"
    value = "Always"
  }

  set
  {
    name  = "fleetManager.database.existingSecret"
    value = var.database_secret_name
  }

  set
  {
    name  = "fleetManager.database.secretKey"
    value = var.database_secret_key
  }

  # Ingress
  set
  {
    name  = "ingress.domain"
    value = var.domain
  }

  set
  {
    name  = "ingress.className"
    value = "gce"
  }

  set
  {
    name  = "ingress.annotations.kubernetes\\.io/ingress\\.global-static-ip-name"
    value = google_compute_global_address.ingress_ip.name
  }

  # Hosting provider. Default is plain-k8s on GKE: standard PVC tenant storage,
  # k8s Secrets, GKE default StorageClass. The GCS-backed tenant storage extras
  # (GCS Fuse CSI + Workload Identity) are opt-in via enable_gcs_storage.
  set
  {
    name  = "hosting.provider"
    value = var.enable_gcs_storage ? "gcp" : "onprem"
  }

  # GCP-only tenant storage settings — rendered only when enable_gcs_storage=true.
  dynamic "set"
  {
    for_each = var.enable_gcs_storage ? {
      "hosting.gcp.projectId"   = var.project_id
      "hosting.gcp.bucketPrefix" = var.bucket_prefix
      "hosting.gcp.csiDriver"   = "gcsfuse.csi.storage.gke.io"
    } : {}
    content
    {
      name  = set.key
      value = set.value
    }
  }

  # Observability
  set
  {
    name  = "observability.cloudLogging"
    value = "true"
  }

  depends_on = [
    helm_release.cert_manager,
  ]
}
