variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "zone_name" {
  description = "Cloud DNS zone name (resource name, not the domain)"
  type        = string
  default     = "opencrane"
}

variable "domain" {
  description = "Authoritative base domain for the OpenCrane installation."
  type        = string
}
