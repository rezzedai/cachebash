variable "project_id" {
  description = "GCP project ID for cerebro-grid"
  type        = string
  default     = "cerebro-grid"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "lite_domain" {
  description = "Public domain name for the cachebash-lite LB endpoint (e.g. lite.cerebro.cachebash.dev)"
  type        = string
}

variable "lite_service_name" {
  description = "Cloud Run service name for cachebash-lite"
  type        = string
  default     = "cachebash-lite"
}

variable "mcp_rate_limit_per_min" {
  description = "Per-IP rate limit (requests/min) on /mcp before ban"
  type        = number
  default     = 120
}

variable "mcp_ban_duration_sec" {
  description = "Ban duration in seconds after /mcp rate limit exceeded"
  type        = number
  default     = 600
}

variable "enroll_rate_limit_per_min" {
  description = "Per-IP rate limit (requests/min) on /enroll before ban"
  type        = number
  default     = 10
}

variable "enroll_ban_duration_sec" {
  description = "Ban duration in seconds after /enroll rate limit exceeded"
  type        = number
  default     = 900
}
