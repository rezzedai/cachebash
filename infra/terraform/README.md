# CacheBash — Terraform Infrastructure

Infrastructure as Code for the CacheBash ecosystem using Terraform.

## What Terraform Manages

| Terraform | Firebase CLI (unchanged) |
|-----------|------------------------|
| GCP API enablement | Firestore rules deploy |
| Cloud Run service + scaling + IAM | Firestore indexes deploy |
| Service accounts + role bindings | Cloud Functions deploy |
| Cloud Scheduler jobs | Firebase Auth providers |
| Firestore database creation | |
| Custom domain mapping | |

## Quick Start (Self-Hosting)

```bash
# 1. Clone and navigate
git clone https://github.com/rezzedai/cachebash.git && cd cachebash

# 2. Bootstrap (creates GCS state bucket, enables APIs)
cd infra/terraform && ./bootstrap.sh your-gcp-project-id

# 3. Configure
cd envs/cachebash-app
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project settings

# 4. Initialize and apply
terraform init -backend-config="bucket=your-gcp-project-id-terraform-state"
terraform plan
terraform apply

# 5. Deploy application code (separate from infra)
cd ../../../services/mcp-server
gcloud run deploy cachebash-mcp --source . --region us-central1 --project your-gcp-project-id

# 6. Deploy Firestore rules and indexes
cd ../../infra
firebase deploy --only firestore:rules,firestore:indexes --project your-gcp-project-id
```

## Importing Existing Resources

If you already have resources running (e.g. from manual `gcloud` setup), import them before the first `terraform plan`:

```bash
cd envs/cachebash-app

# Firestore database
terraform import google_firestore_database.default \
  "projects/YOUR_PROJECT/databases/(default)"

# Cloud Run service
terraform import module.mcp_server.google_cloud_run_v2_service.service \
  "projects/YOUR_PROJECT/locations/us-central1/services/cachebash-mcp"

# Service accounts
terraform import google_service_account.mcp_server \
  "projects/YOUR_PROJECT/serviceAccounts/cachebash-server@YOUR_PROJECT.iam.gserviceaccount.com"
terraform import google_service_account.scheduler \
  "projects/YOUR_PROJECT/serviceAccounts/cachebash-scheduler@YOUR_PROJECT.iam.gserviceaccount.com"

# Scheduler jobs
terraform import module.scheduler_wake_daemon.google_cloud_scheduler_job.job \
  "projects/YOUR_PROJECT/locations/us-central1/jobs/cachebash-wake-daemon"
terraform import module.scheduler_ttl_reaper.google_cloud_scheduler_job.job \
  "projects/YOUR_PROJECT/locations/us-central1/jobs/cachebash-ttl-reaper"
terraform import module.scheduler_github_reconcile.google_cloud_scheduler_job.job \
  "projects/YOUR_PROJECT/locations/us-central1/jobs/cachebash-github-reconcile"
terraform import module.scheduler_health_check.google_cloud_scheduler_job.job \
  "projects/YOUR_PROJECT/locations/us-central1/jobs/cachebash-health-check"
```

## Architecture

```
infra/terraform/
├── bootstrap.sh                    # One-time setup script
├── modules/
│   ├── cloud-run-service/          # Reusable Cloud Run module
│   └── cloud-scheduler-job/        # Reusable Cloud Scheduler module
└── envs/
    └── cachebash-app/              # cachebash-app project environment
        ├── main.tf                 # APIs, Firestore, Cloud Run, Scheduler
        ├── iam.tf                  # Service accounts, role bindings
        ├── variables.tf            # Input variables
        ├── outputs.tf              # Output values
        └── versions.tf             # Provider + backend config
```

## Design Decisions

**Image lifecycle:** Terraform creates the Cloud Run service with a placeholder image and uses `ignore_changes` on the image field. Application deploys happen via `gcloud run deploy --source .` or CI/CD. Terraform manages the envelope (scaling, IAM, env vars), CI manages the code.

**State backend:** Remote state in a GCS bucket (`{project_id}-terraform-state`), created by `bootstrap.sh`. Enables team collaboration and state locking.

**Reusable modules:** `cloud-run-service` and `cloud-scheduler-job` modules are designed for reuse across multiple projects (e.g. voicekeeper-api, clu-api).

## Prerequisites

### Software
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Firebase CLI](https://firebase.google.com/docs/cli) (for Firestore rules/indexes)

### GCP Project
- GCP project with billing enabled
- Authenticated with `gcloud auth application-default login`

### Required GCP APIs
The following APIs will be enabled automatically by Terraform:
- Cloud Run API (`run.googleapis.com`)
- Firestore API (`firestore.googleapis.com`)
- Cloud Scheduler API (`cloudscheduler.googleapis.com`)
- Cloud Build API (`cloudbuild.googleapis.com`)
- Secret Manager API (`secretmanager.googleapis.com`)
- IAM API (`iam.googleapis.com`)
- Firebase API (`firebase.googleapis.com`)
- Cloud Functions API (`cloudfunctions.googleapis.com`)
- Firebase Cloud Messaging API (`fcm.googleapis.com`)

### Required IAM Permissions
Your service account or user must have these roles:
- **Owner** (for initial setup and state bucket creation)

Or these granular roles for production:
- `roles/resourcemanager.projectIamAdmin`
- `roles/iam.serviceAccountAdmin`
- `roles/run.admin`
- `roles/cloudscheduler.admin`
- `roles/firebase.admin`
- `roles/serviceusage.serviceUsageAdmin`
