#!/bin/bash
# One-time bootstrap: creates GCS state bucket and enables required APIs.
# Usage: ./bootstrap.sh <project-id>
#
# Prerequisites:
#   - gcloud CLI authenticated with owner/editor role on the target project
#   - billing account linked to the project

set -euo pipefail

PROJECT_ID="${1:?Usage: ./bootstrap.sh <project-id>}"
REGION="us-central1"
BUCKET_NAME="${PROJECT_ID}-terraform-state"

echo "=== Bootstrapping Terraform for project: ${PROJECT_ID} ==="

# Enable APIs needed before Terraform can run
BOOTSTRAP_APIS=(
  "cloudresourcemanager.googleapis.com"
  "iam.googleapis.com"
  "storage.googleapis.com"
)

echo ""
echo "--- Enabling bootstrap APIs ---"
for api in "${BOOTSTRAP_APIS[@]}"; do
  echo "  Enabling ${api}..."
  gcloud services enable "$api" --project="$PROJECT_ID"
done

# Create GCS bucket for Terraform state
echo ""
echo "--- Creating state bucket: gs://${BUCKET_NAME} ---"
if gsutil ls -b "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "  Bucket already exists, skipping."
else
  gsutil mb -p "$PROJECT_ID" -l "$REGION" -b on "gs://${BUCKET_NAME}"
  gsutil versioning set on "gs://${BUCKET_NAME}"
  echo "  Bucket created with versioning enabled."
fi

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Next steps:"
echo "  cd envs/cachebash-app"
echo "  cp terraform.tfvars.example terraform.tfvars"
echo "  # Edit terraform.tfvars with your project settings"
echo "  terraform init -backend-config=\"bucket=${BUCKET_NAME}\""
echo "  terraform plan"
echo "  terraform apply"
