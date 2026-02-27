# ---------------------------------------------------------------------------
# Service Accounts & IAM Bindings
# ---------------------------------------------------------------------------

# MCP Server service account
resource "google_service_account" "mcp_server" {
  account_id   = "cachebash-server"
  display_name = "CacheBash MCP Server"
  project      = var.project_id
}

# Scheduler service account
resource "google_service_account" "scheduler" {
  account_id   = "cachebash-scheduler"
  display_name = "CacheBash Scheduler"
  project      = var.project_id
}

# MCP Server: Firestore read/write
resource "google_project_iam_member" "mcp_server_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.mcp_server.email}"
}

# Scheduler: Cloud Run invoker (to call internal endpoints)
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = module.mcp_server.service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Cloud Build: deploy permissions (for gcloud run deploy --source)
resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${var.project_id}@cloudbuild.gserviceaccount.com"
}

# Cloud Build: act as the MCP server service account during deploy
resource "google_service_account_iam_member" "cloudbuild_act_as_mcp" {
  service_account_id = google_service_account.mcp_server.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.project_id}@cloudbuild.gserviceaccount.com"
}
