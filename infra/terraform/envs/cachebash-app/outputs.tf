output "mcp_server_url" {
  description = "Cloud Run service URL for the MCP server"
  value       = module.mcp_server.service_url
}

output "mcp_server_name" {
  description = "Cloud Run service name"
  value       = module.mcp_server.service_name
}

output "mcp_server_sa_email" {
  description = "MCP server service account email"
  value       = google_service_account.mcp_server.email
}

output "scheduler_sa_email" {
  description = "Scheduler service account email"
  value       = google_service_account.scheduler.email
}

output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "custom_domain" {
  description = "Custom domain (if configured)"
  value       = var.custom_domain
}
