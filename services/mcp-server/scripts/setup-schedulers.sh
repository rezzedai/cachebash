#!/bin/bash
# Cloud Scheduler setup for CacheBash internal jobs
# Run once per environment. Requires gcloud CLI authenticated to cachebash-app project.
#
# All jobs authenticate via OIDC using the cachebash-scheduler service account.
# The scheduler SA must have Cloud Run Invoker on the Cloud Run service.
#
# Usage:
#   export CLOUD_RUN_URL="https://cachebash-mcp-922749444863.us-central1.run.app"
#   export SCHEDULER_SA="cachebash-scheduler@cachebash-app.iam.gserviceaccount.com"
#   bash setup-schedulers.sh

set -euo pipefail

PROJECT="cachebash-app"
REGION="us-central1"
CLOUD_RUN_URL="${CLOUD_RUN_URL:-https://cachebash-mcp-922749444863.us-central1.run.app}"
SCHEDULER_SA="${SCHEDULER_SA:-cachebash-scheduler@cachebash-app.iam.gserviceaccount.com}"

echo "=== Creating/updating wake daemon scheduler (every 60s) ==="
gcloud scheduler jobs create http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/wake" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-wake-daemon \
  --schedule="* * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/wake" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Wake daemon: polls for orphaned tasks and spawns idle programs" \
  --attempt-deadline="30s"

echo ""
echo "=== Creating/updating TTL reaper scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-ttl-reaper \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/cleanup" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TTL Reaper: cleans expired sessions, relay messages, idempotency keys" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating/updating GitHub reconciliation scheduler (every 15min) ==="
gcloud scheduler jobs create http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-github-reconcile \
  --schedule="*/15 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/reconcile-github" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="GitHub Reconciliation: retries failed GitHub sync operations" \
  --attempt-deadline="120s"

echo ""
echo "=== Creating/updating health check scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/health-check" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Health Check: monitors health indicators, routes alerts" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-health-check \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/health-check" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Health Check: monitors health indicators, routes alerts" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating/updating stale sessions detector scheduler (every 5min) ==="
gcloud scheduler jobs create http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-stale-sessions \
  --schedule="*/5 * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/stale-sessions" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Stale Session Detector: identifies and archives sessions with no recent heartbeat" \
  --attempt-deadline="60s"

echo ""
echo "=== Creating/updating schedule executor (every 60s) ==="
gcloud scheduler jobs create http cachebash-execute-schedules \
  --schedule="* * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/execute-schedules" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Schedule Executor: evaluates cron expressions and creates tasks for due user schedules" \
  --attempt-deadline="30s" 2>/dev/null || \
gcloud scheduler jobs update http cachebash-execute-schedules \
  --schedule="* * * * *" \
  --uri="${CLOUD_RUN_URL}/v1/internal/execute-schedules" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="Schedule Executor: evaluates cron expressions and creates tasks for due user schedules" \
  --attempt-deadline="30s"

echo ""
echo "=== Done. Verify with: ==="
echo "gcloud scheduler jobs list --location=$REGION --project=$PROJECT"
