# CacheBash Deployment Guide

Step-by-step guide to deploying CacheBash to Google Cloud Platform and Firebase. The MCP server is the required part. The mobile app is optional: it is one of several ways people answer agents.

## Prerequisites

1. **Google Cloud Account** with billing enabled
2. **Firebase Project** (can use same GCP project)
3. **gcloud CLI** installed and authenticated
4. **Firebase CLI** installed (`npm install -g firebase-tools`)
5. **Node.js 18+** and npm
6. **Expo and EAS CLI** (optional, for mobile app builds)

## Project Setup

### 1. Create GCP Project

```bash
# Create project
gcloud projects create cachebash-app --name="CacheBash"

# Set as default
gcloud config set project cachebash-app

# Enable billing (replace BILLING_ACCOUNT_ID)
gcloud beta billing projects link cachebash-app --billing-account=BILLING_ACCOUNT_ID
```

### 2. Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  cloudscheduler.googleapis.com \
  firebase.googleapis.com
```

### 3. Initialize Firebase

```bash
# Login to Firebase
firebase login

# Initialize Firebase project (select cachebash-app)
firebase init

# Select: Firestore, Functions, Hosting (optional)
```

## Firestore Configuration

### 1. Create Firestore Database

```bash
# Create Firestore in Native mode (us-central1)
gcloud firestore databases create --region=us-central1
```

### 2. Deploy Security Rules and Indexes

The rules and composite indexes live in the repo: `infra/firestore.rules` and `infra/firestore.indexes.json`. Tenant data sits under `tenants/{userId}/`. API key hashes sit in `keyIndex/`. Signed-in users can read their own tenant's data. Client writes are limited, for example creating a task from the mobile app or answering a question. Client writes to messages and to `keyIndex/` are denied, and so is any path the rules do not list. The server writes through the Admin SDK, which the rules do not restrict.

Deploy them from the repo root. The root `firebase.json` points at both files:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## MCP Server Deployment

### 1. Build and Test Locally

```bash
cd services/mcp-server
npm install
npm run build

# Test locally
npm start

# Verify health endpoint
curl http://localhost:3001/v1/health
```

### 2. Deploy to Cloud Run

```bash
bash scripts/deploy-mcp.sh
```

The script stamps `services/mcp-server/build-info.json` with the git sha (so
`/v1/health` reports which code is live), then runs the bare
`gcloud run deploy cachebash-mcp --source . --region us-central1 --project cachebash-app`
from `services/mcp-server`. Cloud Run builds with buildpacks from that directory. Run
from the repo root, the same command would build the root `Dockerfile` and Cloud Run
would refuse it. `DEPLOY_DRY_RUN=1` prints the directory and command without deploying.

> **Do not pass `--set-env-vars` to a code deploy.** It replaces the service's
> whole environment map. Set the variables and secrets your deployment needs
> through Terraform and Secret Manager.

The scaling/IAM/env envelope (`--min-instances`, `--max-instances`, `--concurrency`,
`--cpu`, `--memory`, `--timeout`, `--allow-unauthenticated`, and the env map) is owned
by Terraform, not by the deploy command --- see `infra/terraform/README.md`:
"Terraform manages the envelope (scaling, IAM, env vars), CI manages the code."
A bare `gcloud run deploy --source .` inherits the existing revision template, so the
envelope survives untouched. Passing those flags by hand is at best a no-op and at
worst a silent reset.

**Note:** `--allow-unauthenticated` is already configured on the service. It is
required because Cloud Run's auth is separate from CacheBash's API key auth --- security
is enforced at the application layer. You do not need to re-pass it on a deploy.

**Rollback:** note the currently serving revision before deploying
(`gcloud run services describe cachebash-mcp --region us-central1 --format='value(status.latestReadyRevisionName)'`)
and route traffic back to it with
`gcloud run services update-traffic cachebash-mcp --region us-central1 --to-revisions <REVISION>=100`.

### 3. Get Service URL

```bash
gcloud run services describe cachebash-mcp --region us-central1 --format 'value(status.url)'
```

Expected output:
```
https://api.cachebash.dev
```

### 4. Test Deployment

```bash
# Health check
curl https://api.cachebash.dev/v1/health

# Expected: {"status":"ok","version":"2.0.0",...,"timestamp":"..."}
```

## Firebase Authentication Setup

### 1. Enable Auth Providers

In Firebase Console:
1. Go to Authentication > Sign-in method
2. Enable **Email/Password**
3. Enable **Google** (for mobile app)

### 2. Create Service Account Key

```bash
# Create service account
gcloud iam service-accounts create cachebash-server \
  --display-name="CacheBash MCP Server"

# Grant Firestore admin role
gcloud projects add-iam-policy-binding cachebash-app \
  --member="serviceAccount:cachebash-server@cachebash-app.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Generate key (only needed for local development)
gcloud iam service-accounts keys create service-account-key.json \
  --iam-account=cachebash-server@cachebash-app.iam.gserviceaccount.com
```

**Note:** Cloud Run uses Workload Identity, so service account keys are not needed in production.

## API Key Setup

### 1. Create API Key via MCP Tool

Once deployed, create API keys for your programs using the MCP server's `create_key` tool or REST endpoint.

**Via curl:**
```bash
# First, create a bootstrap key manually in Firestore Console
# Collection: keyIndex
# Document ID: <sha256 hash of your bootstrap key>
# Fields: { userId: "YOUR_UID", programId: "iso", active: true, createdAt: <timestamp> }

# Then use the bootstrap key to create program keys
curl -X POST https://api.cachebash.dev/v1/keys \
  -H "Authorization: Bearer YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "basher",
    "label": "BASHER production key"
  }'

# Response: { "success": true, "data": { "key": "cb_<64 hex characters>", "keyHash": "..." } }
# SAVE THE KEY — it's shown only once!
```

### 2. Configure MCP Clients

Add API key to `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "cachebash": {
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer cb_..."
      }
    }
  }
}
```

## Cloud Functions Deployment

### 1. Configure Functions

```bash
cd services/functions
npm install
npm run build
```

### 2. Deploy Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy individually
firebase deploy --only functions:onTaskCreate
firebase deploy --only functions:cleanupExpiredSessions
```

### 3. Configure Scheduled Functions

Cloud Scheduler jobs are created automatically by Firebase. Verify schedules:

```bash
gcloud scheduler jobs list --location us-central1
```

Expected schedules (from `services/functions/src/cleanup/`):
- `cleanupExpiredSessions`, `cleanupOrphanedTasks`: every 5 minutes
- `cleanupExpiredRelay`, `processDeadLetters`, `reapExpiredByTTL`: every 15 minutes
- `cleanupLedger`, `cleanupAudit`, `decayProgramState`: every 24 hours

## Mobile App Deployment (optional)

The mobile app is a React Native and Expo project in `apps/mobile/`. Build profiles are in `apps/mobile/eas.json`. Google and GitHub sign-in client IDs are set in `.env` (see `.env.example`, "Mobile App (Expo)").

```bash
npm install -g eas-cli   # eas.json requires EAS CLI 15 or later
cd apps/mobile
npm install

# Internal test build
eas build --profile preview --platform all

# Store build and submit
eas build --profile production --platform ios
eas submit --profile production --platform ios
```

## Verification

### 1. Test MCP Connection

```bash
# Using the CacheBash CLI
npx @rezzed.ai/cachebash ping
```

### 2. Test REST API

```bash
# Create task
curl -X POST https://api.cachebash.dev/v1/tasks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test task",
    "target": "iso",
    "priority": "normal"
  }'

# Get tasks
curl https://api.cachebash.dev/v1/tasks \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. Monitor Cloud Run

```bash
# View logs
gcloud run services logs read cachebash-mcp --region us-central1 --limit 50

# View metrics
gcloud run services describe cachebash-mcp --region us-central1
```

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project ID | — |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID (usually same as GCP) | — |
| `PORT` | No | HTTP server port | 3001 |
| `CACHEBASH_PROFILE` | No | `full` serves every tool domain. `lite` serves the smaller tenant tool set | `full` |
| `AUTH_MODE` | No | `key_identity` makes the API key alone decide the caller's identity | `key_identity` |

## Troubleshooting

### MCP Connection Fails

**Symptom:** `Connection refused` or `401 Unauthorized`

**Fix:**
1. Verify service is deployed: `gcloud run services list`
2. Check API key is valid: `gcloud firestore export --collection-ids=keyIndex`
3. Review logs: `gcloud run services logs read cachebash-mcp --limit 100`

### Rate Limit Errors

**Symptom:** HTTP 429 `Rate limit exceeded`

**Fix:**
1. Check rate limit status in logs
2. Wait for window to reset (max 60 seconds)
3. Consider increasing limits in `config/rateLimits.ts` for your deployment

### Firestore Permission Denied

**Symptom:** `PERMISSION_DENIED: Missing or insufficient permissions`

**Fix:**
1. Verify security rules allow user access
2. Check Cloud Run service account has `roles/datastore.user`
3. Ensure API key matches a valid userId

### Cloud Functions Not Triggering

**Symptom:** No FCM notifications, stale data not cleaned up

**Fix:**
1. Check function deployment: `firebase functions:list`
2. View function logs: `firebase functions:log`
3. Verify triggers in Firestore rules
4. Check Cloud Scheduler jobs: `gcloud scheduler jobs list`

## Rollback

### Revert Cloud Run Deployment

```bash
# List revisions
gcloud run revisions list --service cachebash-mcp --region us-central1

# Rollback to previous revision
gcloud run services update-traffic cachebash-mcp \
  --to-revisions REVISION_NAME=100 \
  --region us-central1
```

### Revert Firestore Rules

```bash
# Firestore rules are versioned — restore via Firebase Console
# Or redeploy from git: firebase deploy --only firestore:rules
```

## Cost Optimization

1. **Cloud Run:** Set `--min-instances 0` for auto-scale to zero
2. **Firestore:** Use TTL fields to auto-delete expired documents (saves on storage costs)
3. **Cloud Functions:** Minimize cold starts by keeping functions small (<10MB)
4. **Logs:** Set retention to 30 days: `gcloud logging sinks update`

## Security Checklist

- [ ] Firestore rules deployed and tested
- [ ] API keys rotated from bootstrap key
- [ ] Cloud Run service account has minimal permissions
- [ ] Rate limiting enabled and tested
- [ ] Audit logging enabled (`modules/audit.ts`)
- [ ] Question encryption verified (server-side AES-256, key derived from the caller's API key)

Built by [Rezzed.ai](https://rezzed.ai)
