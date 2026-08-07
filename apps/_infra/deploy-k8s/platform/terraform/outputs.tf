# -----------------------------------------------------------------------------
# Root outputs
# -----------------------------------------------------------------------------

output "cluster_name" {
  description = "GKE cluster name"
  value       = module.gke.cluster_name
}

output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = module.gke.cluster_endpoint
  sensitive   = true
}

output "registry_url" {
  description = "Registry URL for OpenCrane images (Artifact Registry when enabled, else the external registry)"
  value       = local.registry_url
}

output "dns_name_servers" {
  description = "Cloud DNS name servers (empty unless enable_cloud_dns is on). Delegate your domain to these."
  value       = length(module.dns) > 0 ? module.dns[0].name_servers : []
}

output "dns_setup_instructions" {
  description = "Manual DNS guidance when Cloud DNS is disabled."
  value       = length(module.dns) > 0 ? "Delegate ${var.domain} to dns_name_servers, then point the required host records at the ingress address after deployment." : "Create the required host records at your DNS provider after the ingress address is known."
}

output "kubeconfig_command" {
  description = "Command to configure kubectl"
  value       = "gcloud container clusters get-credentials ${module.gke.cluster_name} --region ${var.region} --project ${var.project_id}"
}
