# CacheBash Deployment Guide

Step-by-step guide to deploying CacheBash to Google Cloud Platform and Firebase.

## Prerequisites

1. **Google Cloud Account** with billing enabled
2. **Firebase Project** (can use same GCP project)
3. **gcloud CLI** installed and authenticated
4. **Firebase CLI** installed (`npm install -g firebase-tools`)
5. **Node.js 18+** and npm
6. **Flutter SDK** (for mobile app deployment)

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

### 2. Deploy Security Rules

Create `firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Global collections (API keys, program state)
    match /apiKeys/{keyHash} {
      allow read: if request.auth != null;
      allow write: if false; // MCP server only
    }

    match /programState/{programId} {
      allow read: if request.auth != null;
      allow write: if false; // MCP server only
    }

    // Per-user collections
    match /users/{userId}/{collection}/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Nested collections (sprint stories)
    match /users/{userId}/tasks/{taskId}/stories/{storyId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only firestore:rules
```

### 3. Create Indexes

Firestore requires composite indexes for complex queries. Create `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "tasks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "target", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "relay",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "target", "order": "ASCENDING" },
        { "fieldPath": "read", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "state", "order": "ASCENDING" },
        { "fieldPath": "lastHeartbeat", "order": "DESCENDING" }
      ]
    }
  ]
}
```

Deploy indexes:
```bash
firebase deploy --only firestore:indexes
```

## MCP Server Deployment

### 1. Build and Test Locally

```bash
cd mcp-server
npm install
npm run build

# Test locally
npm start

# Verify health endpoint
curl http://localhost:3001/v1/health
```

### 2. Deploy to Cloud Run

```bash
# Deploy from source (Cloud Run auto-builds with Buildpacks)
gcloud run deploy cachebash-mcp \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 60 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=cachebash-app,FIREBASE_PROJECT_ID=cachebash-app"
```

**Note:** `--allow-unauthenticated` is required because Cloud Run's auth is separate from CacheBash's API key auth. Security is enforced at the application layer.

### 3. Get Service URL

```bash
gcloud run services describe cachebash-mcp --region us-central1 --format 'value(status.url)'
```

Expected output:
```
https://cachebash-mcp-922749444863.us-central1.run.app
```

### 4. Test Deployment

```bash
# Health check
curl https://cachebash-mcp-922749444863.us-central1.run.app/v1/health

# Expected: {"status":"healthy","timestamp":"2026-02-20T..."}
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
# Collection: apiKeys
# Document ID: <sha256 hash of your bootstrap key>
# Fields: { userId: "YOUR_UID", programId: "iso", active: true, createdAt: <timestamp> }

# Then use the bootstrap key to create program keys
curl -X POST https://cachebash-mcp-922749444863.us-central1.run.app/v1/keys \
  -H "Authorization: Bearer YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "basher",
    "label": "BASHER production key"
  }'

# Response: { "success": true, "data": { "key": "cb_live_...", "keyHash": "..." } }
# SAVE THE KEY — it's shown only once!
```

### 2. Configure MCP Clients

Add API key to `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "cachebash": {
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer cb_live_..."
      }
    }
  }
}
```

## Cloud Functions Deployment

### 1. Configure Functions

```bash
cd firebase/functions
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

Expected jobs:
- `cleanupExpiredSessions` — Daily at 2am UTC
- `cleanupOrphanedTasks` — Daily at 3am UTC
- `cleanupExpiredRelay` — Hourly
- `cleanupLedger` — Weekly on Sunday at 4am UTC

## Mobile App Deployment

### 1. Configure Firebase

Create `app/lib/firebase_options.dart`:

```bash
cd app
firebase apps:create ios com.rezzed.cachebash
firebase apps:create android com.rezzed.cachebash

# Generate config
flutterfire configure
```

### 2. Build and Deploy

**iOS (TestFlight):**
```bash
flutter build ios --release
# Upload to App Store Connect via Xcode
```

**Android (Play Store):**
```bash
flutter build appbundle --release
# Upload to Google Play Console
```

## Verification

### 1. Test MCP Connection

```bash
# Using claude-code CLI
claude-code test-mcp cachebash get_tasks
```

### 2. Test REST API

```bash
# Create task
curl -X POST https://cachebash-mcp-922749444863.us-central1.run.app/v1/tasks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test task",
    "target": "iso",
    "priority": "normal"
  }'

# Get tasks
curl https://cachebash-mcp-922749444863.us-central1.run.app/v1/tasks \
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

## Troubleshooting

### MCP Connection Fails

**Symptom:** `Connection refused` or `401 Unauthorized`

**Fix:**
1. Verify service is deployed: `gcloud run services list`
2. Check API key is valid: `gcloud firestore export --collection-ids=apiKeys`
3. Review logs: `gcloud run services logs read cachebash-mcp --limit 100`

### Rate Limit Errors

**Symptom:** HTTP 429 `Rate limit exceeded`

**Fix:**
1. Check rate limit status in logs
2. Wait for window to reset (max 60 seconds)
3. Consider increasing limits in `middleware/rateLimiter.ts` for your deployment

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
- [ ] DNS rebinding protection active (`security/dns-rebinding.ts`)
- [ ] E2E encryption verified for questions

Built by [Rezzed.ai](https://rezzed.ai)
