variable "name" {
  description = "Scheduler job name"
  type        = string
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "description" {
  description = "Job description"
  type        = string
  default     = ""
}

variable "schedule" {
  description = "Cron schedule expression"
  type        = string
}

variable "uri" {
  description = "HTTP target URI"
  type        = string
}

variable "service_account_email" {
  description = "Service account email for OIDC authentication (optional — omit when using headers for auth)"
  type        = string
  default     = null
}

variable "oidc_audience" {
  description = "OIDC token audience (optional — required when service_account_email is set)"
  type        = string
  default     = null
}

variable "headers" {
  description = "Custom HTTP headers to include with each request (e.g. Authorization)"
  type        = map(string)
  default     = {}
}

variable "time_zone" {
  description = "Time zone for the schedule"
  type        = string
  default     = "Etc/UTC"
}

variable "attempt_deadline" {
  description = "Maximum time for a job attempt"
  type        = string
  default     = "60s"
}

variable "retry_count" {
  description = "Number of retry attempts"
  type        = number
  default     = 1
}

variable "min_backoff" {
  description = "Minimum backoff duration"
  type        = string
  default     = "5s"
}

variable "max_backoff" {
  description = "Maximum backoff duration"
  type        = string
  default     = "60s"
}
