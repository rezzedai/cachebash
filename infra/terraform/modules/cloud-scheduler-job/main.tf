resource "google_cloud_scheduler_job" "job" {
  name        = var.name
  description = var.description
  schedule    = var.schedule
  time_zone   = var.time_zone
  project     = var.project_id
  region      = var.region

  attempt_deadline = var.attempt_deadline

  retry_config {
    retry_count          = var.retry_count
    min_backoff_duration = var.min_backoff
    max_backoff_duration = var.max_backoff
  }

  http_target {
    http_method = "POST"
    uri         = var.uri
    headers     = length(var.headers) > 0 ? var.headers : null

    dynamic "oidc_token" {
      for_each = var.service_account_email != null ? [1] : []
      content {
        service_account_email = var.service_account_email
        audience              = var.oidc_audience
      }
    }
  }
}
