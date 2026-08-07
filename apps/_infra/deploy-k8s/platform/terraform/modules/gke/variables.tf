variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "cluster_name" {
  description = "Name for the GKE cluster"
  type        = string
}

variable "vpc_id" {
  description = "Self-link of the VPC network. Empty → use the project default VPC."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Self-link of the subnet. Empty → use the project default subnet."
  type        = string
  default     = ""
}

variable "enable_private_nodes" {
  description = "Provision private nodes (requires a custom VPC with Cloud NAT for egress)."
  type        = bool
  default     = false
}

variable "enable_secrets_encryption" {
  description = "Encrypt cluster Secrets at rest (etcd) with a customer-managed Cloud KMS key (CMEK). Provisions a key ring + key in var.region and grants the GKE service agent encrypt/decrypt. Protects etcd/backups, not in-cluster `kubectl get secret` (RBAC remains that boundary)."
  type        = bool
  default     = true
}
