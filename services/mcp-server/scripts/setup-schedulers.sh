#!/bin/bash
# Cloud Scheduler setup for CacheBash internal jobs
# Run once per environment. Requires gcloud CLI authenticated to cachebash-app project.
#
# IMPORTANT: Set INTERNAL_API_KEY environment variable before running:
#   export INTERNAL_API_KEY="your-api-key-here"
#
# This API key is used by Cloud Scheduler to authenticate to internal endpoints.

set -euo pipefail

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  echo "Error: INTERNAL_API_KEY environment variable is not set"
  echo "Please set it with: export INTERNAL_API_KEY=\"your-api-key-here\""
  exit 1
fi

PROJECT="cachebash-app"
REGION="us-central1"
SERVICE_URL="https://api.cachebash.dev"

# Create service account for scheduler (if not exists)
SA_NAME="cachebash-scheduler"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "=== Setting up Cloud Scheduler service account ==="
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="CacheBash Scheduler" \
  --project="$PROJECT" 2>/dev/null || echo "Service account already exists"

# Grant invoker role on Cloud Run
gcloud run services add-iam-policy-binding cachebash-mcp \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker" \
  --region="$REGION" \
  --project="$PROJECT"

echo ""
echo "=== Creating wake daemon scheduler (every 60s) ==="
gcloud scheduler jobs create http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${SERVICE_URL}/v1/internal/wake" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${SERVICE_URL}/v1/internal/wake" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s"

echo ""
echo "=== Creating TTL reaper scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating GitHub reconciliation scheduler (every 15min) ==="
gcloud scheduler jobs create http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s"

echo ""
echo "=== Creating health check scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/health-check" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GRIDBOT Health Check: monitors 6 health indicators, routes alerts" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/health-check" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GRIDBOT Health Check: monitors 6 health indicators, routes alerts" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating stale sessions detector scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s"

echo ""
echo "=== Done. Verify with: ==="
echo "gcloud scheduler jobs list --location=$REGION --project=$PROJECT"
