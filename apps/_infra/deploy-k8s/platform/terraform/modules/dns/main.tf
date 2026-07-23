# -----------------------------------------------------------------------------
# Cloud DNS module — managed zone + the shared zone-write identity (external-dns)
#
# Owns the platform's managed zone and the FIXED, install-time records the chart
# needs the moment it comes up:
#   - `*.<domain>`          → ingress IP  (resolves every ORG APEX `<org>.<domain>`)
#   - `<domain>` (apex)     → ingress IP
#   - opencrane-ui host    → ingress IP  (the fixed super-operator host, distinct
#                                           from the org wildcard)
#
# Per-host / per-org records are NOT written by Terraform. external-dns owns them at
# RUNTIME: the cluster-tenants operator declares each org's records as a namespaced
# `DNSEndpoint` CR and the external-dns controller reconciles them into THIS zone (run
# with --source=crd, scoped to <domain>). Terraform therefore provisions only the zone,
# the install-time platform records, and the zone-WRITE identity the controllers share —
# it must NOT write per-org/per-host records itself (the old imperative Cloud DNS client
# is gone). See dns-endpoint.client.ts in the fleet-operator app (now in the WeOwnAI repo,
# elewa-git/opencrane#150).
#
# Identity vs records are DECOUPLED by dependency. The zone + the shared DNS-writer GSA
# need nothing from the running app, so they are created whenever this module runs (i.e.
# `enable_cloud_dns`) — that is what lets a cluster-only Terraform flow provision the
# zone-write identity up front so cert-manager DNS-01 can issue, with `--dns-writer-gsa`
# reading the `dns_writer_service_account_email` output. The install-time A-records DO
# need the ingress IP, so they are gated on `ingress_ip` and skipped until it is known
# (pass it, or re-apply once the app is up).
# -----------------------------------------------------------------------------

resource "google_dns_managed_zone" "opencrane"
{
  name        = "${var.zone_name}-zone"
  project     = var.project_id
  dns_name    = "${var.domain}."
  description = "OpenCrane platform DNS zone (fixed-wildcard topology; per-org records via external-dns)"
}

# Platform org-wildcard: resolves every org apex `<org>.<domain>` to the ingress IP.
# Gated on a known ingress IP so the zone + identity can provision before the app exists.
resource "google_dns_record_set" "wildcard"
{
  count        = var.ingress_ip != "" ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.opencrane.name
  name         = "*.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [var.ingress_ip]
}

# Apex record for the base domain.
resource "google_dns_record_set" "apex"
{
  count        = var.ingress_ip != "" ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.opencrane.name
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [var.ingress_ip]
}

# Fixed super-operator / opencrane-ui host (distinct from the org wildcard). Defaults
# to `platform.<domain>`; matches ingress.controlPlaneHost in the chart.
resource "google_dns_record_set" "control_plane"
{
  count        = var.ingress_ip != "" ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.opencrane.name
  name         = "${coalesce(var.control_plane_host, "platform.${var.domain}")}."
  type         = "A"
  ttl          = 300
  rrdatas      = [var.ingress_ip]
}

# -----------------------------------------------------------------------------
# Shared zone-WRITE identity (Workload Identity).
#
# BOTH external-dns (reconciling per-org DNSEndpoint CRs) and the cert-manager DNS-01
# solver (issuing the per-org wildcard TLS) need write access to THIS zone. They SHARE a
# single Google service account bound `roles/dns.admin` on the project — exactly one
# binding, impersonated by both controllers' Kubernetes service accounts via Workload
# Identity, never duplicated per controller. For an EXTERNAL (non-Terraform) zone, skip
# this and hand each controller an SA-key file at install instead (--dns01-credentials).
# -----------------------------------------------------------------------------
resource "google_service_account" "dns_writer"
{
  project      = var.project_id
  account_id   = var.dns_writer_account_id
  display_name = "OpenCrane DNS writer (external-dns + cert-manager DNS-01)"
}

# Zone-write capability: roles/dns.admin on the project that hosts the managed zone.
resource "google_project_iam_member" "dns_writer_admin"
{
  project = var.project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${google_service_account.dns_writer.email}"
}

# Workload Identity: let each controller's Kubernetes SA impersonate the shared GSA.
# `<ns>/<ksa>` for external-dns and the cert-manager solver — both bound to the SAME GSA.
resource "google_service_account_iam_member" "dns_writer_wi"
{
  for_each = toset(var.dns_writer_ksa_members)

  service_account_id = google_service_account.dns_writer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${each.value}]"
}
