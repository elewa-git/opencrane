# -----------------------------------------------------------------------------
# Cloud DNS module — authoritative managed zone only.
#
# Application host records depend on the deployed ingress address and remain an explicit
# post-deployment operation. Terraform does not own an application deployment or runtime DNS
# controller.
# -----------------------------------------------------------------------------

resource "google_dns_managed_zone" "opencrane"
{
  name        = "${var.zone_name}-zone"
  project     = var.project_id
  dns_name    = "${var.domain}."
  description = "OpenCrane authoritative DNS zone"
}
