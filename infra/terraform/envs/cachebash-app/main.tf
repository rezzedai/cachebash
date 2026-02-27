# ---------------------------------------------------------------------------
# CacheBash App — GCP Infrastructure
# ---------------------------------------------------------------------------

locals {
  service_url = var.custom_domain != "" ? "https://${var.custom_domain}" : module.mcp_server.service_url
}

# ---------------------------------------------------------------------------
# API Enablement
# ---------------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "firestore.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "firebase.googleapis.com",
    "cloudfunctions.googleapis.com",
    "fcm.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Firestore Database
# ---------------------------------------------------------------------------

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis["firestore.googleapis.com"]]

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Cloud Run — MCP Server
# ---------------------------------------------------------------------------

module "mcp_server" {
  source = "../../modules/cloud-run-service"

  name                  = "cachebash-mcp"
  project_id            = var.project_id
  region                = var.region
  service_account_email = google_service_account.mcp_server.email
  port                  = 3001
  min_instances         = var.mcp_min_instances
  max_instances         = var.mcp_max_instances
  allow_unauthenticated = true

  env_vars = merge(
    {
      FIREBASE_PROJECT_ID = var.project_id
    },
    var.mcp_server_env_vars,
  )

  depends_on = [google_project_service.apis["run.googleapis.com"]]
}

# Custom domain mapping (conditional)
resource "google_cloud_run_domain_mapping" "api" {
  count = var.custom_domain != "" ? 1 : 0

  location = var.region
  name     = var.custom_domain
  project  = var.project_id

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = module.mcp_server.service_name
  }

  depends_on = [module.mcp_server]
}

# ---------------------------------------------------------------------------
# Cloud Scheduler Jobs
# ---------------------------------------------------------------------------

module "scheduler_wake_daemon" {
  source = "../../modules/cloud-scheduler-job"

  name                  = "cachebash-wake-daemon"
  project_id            = var.project_id
  region                = var.region
  schedule              = "* * * * *"
  uri                   = "${local.service_url}/v1/internal/wake"
  service_account_email = google_service_account.scheduler.email
  oidc_audience         = local.service_url
  attempt_deadline      = "30s"
  description           = "Wake daemon: polls for orphaned tasks and spawns idle programs"

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

module "scheduler_ttl_reaper" {
  source = "../../modules/cloud-scheduler-job"

  name                  = "cachebash-ttl-reaper"
  project_id            = var.project_id
  region                = var.region
  schedule              = "*/5 * * * *"
  uri                   = "${local.service_url}/v1/internal/cleanup"
  service_account_email = google_service_account.scheduler.email
  oidc_audience         = local.service_url
  attempt_deadline      = "60s"
  description           = "TTL Reaper: cleans expired sessions, relay messages, idempotency keys"

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

module "scheduler_github_reconcile" {
  source = "../../modules/cloud-scheduler-job"

  name                  = "cachebash-github-reconcile"
  project_id            = var.project_id
  region                = var.region
  schedule              = "*/15 * * * *"
  uri                   = "${local.service_url}/v1/internal/reconcile-github"
  service_account_email = google_service_account.scheduler.email
  oidc_audience         = local.service_url
  attempt_deadline      = "120s"
  description           = "GitHub Reconciliation: retries failed GitHub sync operations"

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

module "scheduler_health_check" {
  source = "../../modules/cloud-scheduler-job"

  name                  = "cachebash-health-check"
  project_id            = var.project_id
  region                = var.region
  schedule              = "*/5 * * * *"
  uri                   = "${local.service_url}/v1/internal/health-check"
  service_account_email = google_service_account.scheduler.email
  oidc_audience         = local.service_url
  attempt_deadline      = "60s"
  description           = "Health Check: monitors health indicators, routes alerts"

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}
