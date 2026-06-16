output "lb_ip_address" {
  description = "Static IP address of the external HTTPS load balancer"
  value       = google_compute_global_address.lite_ip.address
}

output "lb_domain" {
  description = "Configured domain for the LB (point DNS A record to lb_ip_address)"
  value       = var.lite_domain
}

output "lite_service_url" {
  description = "Direct Cloud Run service URL (unreachable externally after G-1 — LB-only ingress)"
  value       = module.cachebash_lite.service_url
}

output "cloud_armor_policy" {
  description = "Cloud Armor security policy name attached to the LB backend"
  value       = google_compute_security_policy.cerebro_armor.name
}

output "backend_service_name" {
  description = "LB backend service name"
  value       = google_compute_backend_service.lite_backend.name
}
