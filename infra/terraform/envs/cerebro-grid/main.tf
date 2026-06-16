# ---------------------------------------------------------------------------
# Cerebro Grid — Secure Edge
#
# Provisions the LB + Cloud Armor + internal-ingress layer required by
# SARK GO-WITH-CONTROLS (grid/assessments/sark-assessment-cerebro-ungate-2026-06-16.md).
#
# ⛔ HARD GATE G-1: ingress=INTERNAL_LOAD_BALANCER + LB + Armor are applied here.
#    The IAM allUsers invoker (allow_unauthenticated) is in iam.tf and is GATED —
#    see comment there. Do NOT apply that section until SARK live-verifies that the
#    direct *.run.app URL returns 403/404 from outside the LB.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# API Enablement
# ---------------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "compute.googleapis.com",
    "certificatemanager.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Cloud Run — cachebash-lite (ingress restricted to LB-only)
# Deployed via gcloud (cerebro/deploy/cloud-run-cerebro-grid.yaml).
# Terraform manages the ingress setting and IAM gate.
# ---------------------------------------------------------------------------

module "cachebash_lite" {
  source = "../../modules/cloud-run-service"

  name                  = var.lite_service_name
  project_id            = var.project_id
  region                = var.region
  service_account_email = "cachebash-lite@${var.project_id}.iam.gserviceaccount.com"
  port                  = 8080
  min_instances         = 0
  max_instances         = 2
  request_timeout       = "300s"
  health_path           = "/health"

  # ⛔ HARD GATE G-1: restrict direct *.run.app URL — only LB traffic admitted.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  # ⛔ HARD GATE G-1: allUsers invoker NOT set until SARK live-verifies G-1.
  # See iam.tf — the google_cloud_run_v2_service_iam_member.public_invoker
  # resource is defined there with a comment marking the SARK gate.
  allow_unauthenticated = false

  env_vars = {
    CACHEBASH_PROFILE  = "lite"
    CACHEBASH_TENANT_ID = "cerebro"
  }

  depends_on = [google_project_service.apis["run.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Cloud Armor Security Policy (G-3)
# ---------------------------------------------------------------------------

resource "google_compute_security_policy" "cerebro_armor" {
  name    = "cachebash-lite-armor"
  project = var.project_id

  # G-2: Adaptive Protection (L7 DDoS) — mandatory per SARK G-3
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable          = true
      rule_visibility = "STANDARD"
    }
  }

  advanced_options_config {
    log_level = "VERBOSE"
  }

  # Rule 1000: /enroll per-IP rate-based ban (strictest — ~10/min, 900s ban)
  # /enroll is the only pre-auth surface; SARK G-3 mandates stricter limit than /mcp.
  rule {
    priority    = 1000
    action      = "rate_based_ban"
    description = "SARK G-3: /enroll per-IP ban — ${var.enroll_rate_limit_per_min}/min, ${var.enroll_ban_duration_sec}s ban"

    match {
      expr {
        expression = "request.path.startsWith('/enroll')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.enroll_rate_limit_per_min
        interval_sec = 60
      }

      ban_duration_sec = var.enroll_ban_duration_sec
    }
  }

  # Rule 2000: /mcp per-IP rate-based ban (~60–120/min, 600s ban)
  rule {
    priority    = 2000
    action      = "rate_based_ban"
    description = "SARK G-3: /mcp per-IP ban — ${var.mcp_rate_limit_per_min}/min, ${var.mcp_ban_duration_sec}s ban"

    match {
      expr {
        expression = "request.path.startsWith('/mcp')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.mcp_rate_limit_per_min
        interval_sec = 60
      }

      ban_duration_sec = var.mcp_ban_duration_sec
    }
  }

  # Rule 3000: OWASP CRS WAF — preview mode to avoid JSON-RPC false positives.
  # SARK G-3: "preview-tuned to avoid false positives on JSON-RPC/MCP".
  # Switch preview = false once tuning is validated against real MCP traffic.
  rule {
    priority    = 3000
    action      = "deny(403)"
    preview     = true
    description = "SARK G-3: OWASP CRS WAF (preview — tune before enforcing to avoid JSON-RPC false positives)"

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('crs-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Default: allow all other traffic (edge filtering is by rate-limit + WAF above)
  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Default allow"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Serverless NEG — points LB traffic to the Cloud Run service
# ---------------------------------------------------------------------------

resource "google_compute_region_network_endpoint_group" "lite_neg" {
  name                  = "cachebash-lite-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = module.cachebash_lite.service_name
  }

  depends_on = [
    google_project_service.apis["compute.googleapis.com"],
    module.cachebash_lite,
  ]
}

# ---------------------------------------------------------------------------
# Backend Service — attaches Cloud Armor + wires the NEG
# ---------------------------------------------------------------------------

resource "google_compute_backend_service" "lite_backend" {
  name                  = "cachebash-lite-backend"
  project               = var.project_id
  protocol              = "HTTPS"
  timeout_sec           = 3600
  security_policy       = google_compute_security_policy.cerebro_armor.id
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.lite_neg.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# External HTTPS Load Balancer
# ---------------------------------------------------------------------------

resource "google_compute_global_address" "lite_ip" {
  name    = "cachebash-lite-ip"
  project = var.project_id

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

resource "google_compute_managed_ssl_certificate" "lite_cert" {
  name    = "cachebash-lite-cert"
  project = var.project_id

  managed {
    domains = [var.lite_domain]
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

resource "google_compute_url_map" "lite_urlmap" {
  name            = "cachebash-lite-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_service.lite_backend.id
}

resource "google_compute_target_https_proxy" "lite_https" {
  name             = "cachebash-lite-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.lite_urlmap.id
  ssl_certificates = [google_compute_managed_ssl_certificate.lite_cert.id]
}

# HTTP → HTTPS redirect
resource "google_compute_url_map" "lite_http_redirect" {
  name    = "cachebash-lite-http-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "lite_http" {
  name    = "cachebash-lite-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.lite_http_redirect.id
}

resource "google_compute_global_forwarding_rule" "lite_https" {
  name                  = "cachebash-lite-https"
  project               = var.project_id
  ip_address            = google_compute_global_address.lite_ip.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.lite_https.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "lite_http" {
  name                  = "cachebash-lite-http"
  project               = var.project_id
  ip_address            = google_compute_global_address.lite_ip.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.lite_http.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
