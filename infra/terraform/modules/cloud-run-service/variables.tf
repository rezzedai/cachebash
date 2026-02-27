variable "name" {
  description = "Cloud Run service name"
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

variable "image" {
  description = "Container image (placeholder — actual deploys via gcloud/CI)"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "service_account_email" {
  description = "Service account email for the Cloud Run service"
  type        = string
}

variable "port" {
  description = "Container port"
  type        = number
  default     = 3001
}

variable "env_vars" {
  description = "Environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU limit"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit"
  type        = string
  default     = "512Mi"
}

variable "health_path" {
  description = "Health check endpoint path"
  type        = string
  default     = "/v1/health"
}

variable "request_timeout" {
  description = "Request timeout duration"
  type        = string
  default     = "300s"
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated (public) access"
  type        = bool
  default     = false
}
