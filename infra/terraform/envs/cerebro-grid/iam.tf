# ---------------------------------------------------------------------------
# IAM — cerebro-grid
# ---------------------------------------------------------------------------

# cachebash-lite SA already provisioned via gcloud (cerebro/deploy/cloud-run-cerebro-grid.yaml).
# Firestore (ADC via workload identity) is handled by the SA at deploy time.

# ⛔ HARD GATE G-1 — allUsers invoker BLOCKED until SARK live-verifies:
#    1. ingress=INTERNAL_LOAD_BALANCER is confirmed applied on the Cloud Run service.
#    2. LB + Cloud Armor policy are attached and active.
#    3. curl to the direct *.run.app URL from outside the LB returns 403/404.
#
# After SARK signs off on G-1, uncomment this block AND set
# allow_unauthenticated = true in the module.cachebash_lite call in main.tf.
# Do NOT apply this before SARK GO on G-1.
#
# resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
#   project  = var.project_id
#   location = var.region
#   name     = module.cachebash_lite.service_name
#   role     = "roles/run.invoker"
#   member   = "allUsers"
# }
