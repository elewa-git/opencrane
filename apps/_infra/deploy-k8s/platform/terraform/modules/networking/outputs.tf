output "vpc_id" {
  description = "Self-link of the VPC network"
  value       = google_compute_network.vpc.id
}

output "subnet_id" {
  description = "Self-link of the subnet"
  value       = google_compute_subnetwork.subnet.id
}
