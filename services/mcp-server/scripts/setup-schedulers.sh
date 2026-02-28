#!/bin/bash
# Cloud Scheduler setup for CacheBash internal jobs
# Run once per environment. Requires gcloud CLI authenticated to cachebash-app project.
#
# IMPORTANT: Set INTERNAL_API_KEY environment variable before running:
#   export INTERNAL_API_KEY="your-api-key-here"
#
# This API key is used by Cloud Scheduler to authenticate to internal endpoints.
# The key must be a valid CacheBash API key (cb_* prefix).

set -euo pipefail

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  echo "Error: INTERNAL_API_KEY environment variable is not set"
  echo "Please set it with: export INTERNAL_API_KEY=\"your-api-key-here\""
  exit 1
fi

PROJECT="cachebash-app"
REGION="us-central1"
SERVICE_URL="https://api.cachebash.dev"

echo "=== Creating/updating wake daemon scheduler (every 60s) ==="
gcloud scheduler jobs create http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${SERVICE_URL}/v1/internal/wake" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${SERVICE_URL}/v1/internal/wake" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s"

echo ""
echo "=== Creating/updating TTL reaper scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating/updating GitHub reconciliation scheduler (every 15min) ==="
gcloud scheduler jobs create http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s"

echo ""
echo "=== Creating/updating health check scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/health-check" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Health Check: monitors health indicators, routes alerts" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/health-check" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Health Check: monitors health indicators, routes alerts" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating/updating stale sessions detector scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --headers="Authorization=Bearer ${INTERNAL_API_KEY}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s"

echo ""
echo "=== Done. Verify with: ==="
echo "gcloud scheduler jobs list --location=$REGION --project=$PROJECT"
