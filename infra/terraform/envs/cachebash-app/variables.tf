variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "custom_domain" {
  description = "Custom domain for Cloud Run service (e.g. api.cachebash.dev). Empty string disables domain mapping."
  type        = string
  default     = ""
}

variable "mcp_server_env_vars" {
  description = "Environment variables for the MCP server container"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "internal_api_key" {
  description = "CacheBash API key for Cloud Scheduler to authenticate to internal endpoints"
  type        = string
  sensitive   = true
}

variable "mcp_min_instances" {
  description = "Minimum Cloud Run instances (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "mcp_max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 10
}
