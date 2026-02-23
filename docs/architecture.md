# CacheBash Architecture

Technical deep-dive into CacheBash's system design, components, data flow, and security model.

## System Overview

CacheBash is a distributed orchestration platform connecting AI agent sessions to a mobile monitoring interface. The system consists of three main parts:

1. **MCP Server** — Cloud Run service exposing 18 tools via MCP protocol + REST API
2. **Firestore Database** — 4 collections per user storing tasks, messages, sessions, and metrics
3. **Mobile App** — Flutter app (iOS/Android) for monitoring, questions, and alerts

The MCP server acts as the central hub, authenticating requests, enforcing rate limits, managing state transitions, and routing messages between agents.

## Components

### MCP Server (`mcp-server/src/`)

| Component | File(s) | Responsibility |
|-----------|---------|----------------|
| **Entry Point** | `index.ts` | Server initialization, HTTP routing, session management |
| **Transport Layer** | `transport/CustomHTTPTransport.ts`<br>`transport/SessionManager.ts`<br>`transport/MessageParser.ts`<br>`transport/rest.ts` | MCP HTTP transport implementation, session lifecycle, message parsing, REST router with full MCP parity |
| **Authentication** | `auth/apiKeyValidator.ts`<br>`auth/firebaseAuthValidator.ts` | API key validation (SHA-256 lookup), Firebase JWT validation, dual auth system |
| **Middleware** | `middleware/rateLimiter.ts`<br>`middleware/gate.ts`<br>`middleware/correlationId.ts` | Sliding window rate limiting (120 read/60 write per min), source verification, audit logging, request correlation |
| **Business Logic** | `modules/dispatch.ts`<br>`modules/relay.ts`<br>`modules/pulse.ts`<br>`modules/signal.ts`<br>`modules/dream.ts`<br>`modules/sprint.ts` | Task CRUD, inter-program messaging, session tracking, user questions/alerts, Dream Mode, sprint orchestration |
| **Lifecycle Engine** | `lifecycle/engine.ts` | State machine for task lifecycle transitions (created → active → done) |
| **Encryption** | `encryption/crypto.ts` | AES-256-CBC encryption for sensitive fields (questions, API keys) |
| **Security** | `security/dns-rebinding.ts` | DNS rebinding attack prevention |
| **Telemetry** | `modules/ledger.ts`<br>`modules/metrics.ts`<br>`modules/trace.ts` | Cost tracking, aggregated metrics, execution traces |
| **Program Config** | `config/programs.ts` | Valid program IDs, multicast groups (council, builders, intelligence, all) |

### Cloud Functions (`firebase/functions/`)

| Function | Trigger | Purpose |
|----------|---------|---------|
| `onTaskCreate` | `users/{uid}/tasks/{id}` onCreate | Send FCM push notification to mobile app |
| `onTaskUpdate` | `users/{uid}/tasks/{id}` onUpdate | Notify mobile app of status changes |
| `onSessionUpdate` | `users/{uid}/sessions/{id}` onUpdate | Handle session state transitions |
| `cleanupExpiredSessions` | Scheduled (daily) | Archive sessions with stale heartbeats |
| `cleanupOrphanedTasks` | Scheduled (daily) | Clean up tasks orphaned by dead sessions |
| `cleanupExpiredRelay` | Scheduled (hourly) | Delete relay messages past TTL |
| `cleanupLedger` | Scheduled (weekly) | Prune ledger entries older than 90 days |

### Mobile App (`app/`)

Flutter app with screens for:
- Active sessions (real-time heartbeat monitoring)
- Pending questions (E2E encrypted, swipe to answer)
- Task feed (filtered by priority/status)
- Fleet health (all programs, last heartbeat, pending work)
- Cost dashboard (token/USD spend by program)

## Data Flow

### Example: Program A sends message to Program B

```
1. Program A (Claude Code session)
   ↓ MCP tool call: send_message(source="A", target="B", message_type="QUERY", message="...")

2. CacheBash MCP Server
   ↓ Validate Bearer token → AuthContext (userId, programId, encryptionKey)
   ↓ Verify source matches programId (gate.ts)
   ↓ Check rate limit (rateLimiter.ts)
   ↓ Resolve target (config/programs.ts — supports multicast groups)
   ↓ Write to Firestore: users/{uid}/relay/{msgId}
   ↓ Emit event (events.ts) for telemetry
   ↓ Return success response

3. Firestore
   ↓ Message written with TTL (default 24h)
   ↓ onTaskCreate Cloud Function triggered
   ↓ FCM push notification sent to mobile app

4. Program B (Claude Code session)
   ↓ Polls: get_messages(sessionId="B", target="B")
   ↓ MCP server reads users/{uid}/relay where target="B" and read=false
   ↓ Marks message as read (optional)
   ↓ Returns message to Program B

5. Program B processes message
   ↓ Sends ACK: send_message(source="B", target="A", message_type="ACK", reply_to=msgId)
```

### Example: User answers question on mobile

```
1. Program creates question
   ↓ create_task(type="question", question={content:"...", options:[...]})
   ↓ Server encrypts question.content with user's encryption key
   ↓ Writes to users/{uid}/tasks/{id}

2. Mobile app receives FCM push
   ↓ Fetches encrypted question from Firestore
   ↓ Decrypts locally using derived key
   ↓ Displays to user

3. User taps answer
   ↓ App encrypts response
   ↓ Updates Firestore: tasks/{id}.question.response + answeredAt

4. Program polls
   ↓ get_response(questionId)
   ↓ Server returns decrypted response
   ↓ Program continues execution
```

## Authentication Model

CacheBash uses **dual authentication**:

### API Keys (Primary)
- Programs authenticate with `Authorization: Bearer <api-key>` header
- API keys are SHA-256 hashed and stored in `apiKeys/{keyHash}` collection
- Each key is scoped to a single program (`programId` field)
- Keys are derived into AES-256 encryption keys for E2E encryption
- Lifecycle: create (returned once) → validate on each request → revoke (soft delete)

### Firebase JWT (Secondary)
- Mobile app uses Firebase Authentication
- JWT tokens validated via Firebase Admin SDK
- Used for mobile app REST endpoints only

### Key Derivation
```typescript
// API key → SHA-256 hash (for lookup)
keyHash = sha256(apiKey)

// API key → AES-256 encryption key (for E2E encryption)
encryptionKey = pbkdf2(apiKey, salt=sha256(apiKey).substring(0,16), 100k iterations, 32 bytes)
```

## Rate Limiting

Sliding window implementation with per-user limits:

| Category | Limit | Tools |
|----------|-------|-------|
| **Read** | 120 req/min | `get_tasks`, `get_messages`, `list_sessions`, `get_fleet_health`, etc. |
| **Write** | 60 req/min | `create_task`, `send_message`, `update_session`, etc. |
| **Auth** | 10 attempts/min per IP | Key validation failures |

Window: 60 seconds, sliding. Cleanup runs every 2 minutes to prune stale entries.

Rate limit exceeded returns HTTP 429 with `Retry-After` header.

## Security

### Encryption
- **Algorithm:** AES-256-CBC
- **Key Derivation:** PBKDF2 (100k iterations, SHA-256)
- **Fields Encrypted:** `question.content`, `question.response`, `question.options` (opt-in)
- **IV:** 16 random bytes prepended to ciphertext
- **Format:** Base64-encoded (IV + encrypted payload)

### DNS Rebinding Protection
- Host header validation against allowed origins
- Reject requests with suspicious Host headers
- Prevent CSRF via DNS rebinding attacks

### Audit Logging
- All tool calls logged to `users/{uid}/audit` with:
  - Timestamp, programId, tool, success/failure, correlationId
  - Used by administrators for security review
  - Retention: 90 days

### Source Verification
- Every task/message must have `source` field
- Middleware verifies `source` matches authenticated `programId`
- Prevents program impersonation

## Infrastructure

### Google Cloud Platform

| Resource | Name | Region | Purpose |
|----------|------|--------|---------|
| **Cloud Run** | `cachebash-mcp` | us-central1 | MCP server (Node.js 18+, auto-scaling) |
| **Firestore** | `(default)` | us-central1 | Primary database (4 collections per user) |
| **Cloud Functions** | `onTaskCreate`, `cleanupExpired*` | us-central1 | Triggers and scheduled cleanup |
| **Firebase Auth** | — | Global | User authentication for mobile app |

### Deployment
- **Container:** Cloud Run auto-builds from source via Buildpacks
- **Scaling:** 0-10 instances, concurrency 80
- **Env Vars:** `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT_ID`
- **Health Check:** `GET /v1/health` (200 OK if Firestore reachable)

### Cost Profile
- **Cloud Run:** ~$0.05/day (mostly idle, bursts during active sessions)
- **Firestore:** ~$1-3/month (read/write/storage)
- **Cloud Functions:** Negligible (free tier covers ~90% of usage)

## Known Limitations

1. **MCP Session Expiry** — Long-running sessions (>1 hour idle) may lose MCP connection. Programs should fall back to REST API. See `mcp-server/README.md` for REST fallback pattern.

2. **Rate Limit Precision** — Sliding window is approximate (timestamp array). Not transactional across distributed instances.

3. **No Horizontal Sharding** — Single Firestore database. Scales to ~10k tasks/min before write contention. Not an issue at current scale.

4. **E2E Encryption Not Default** — Only `question` type tasks are encrypted. Messages (`relay`) are plaintext. Design choice: Grid programs need to read messages, encryption would break routing.

5. **No Dead Letter Queue Persistence** — Failed message deliveries are logged but not retried. Programs must implement retry logic.

6. **Firebase Auth Only for Mobile** — API keys are the primary auth mechanism. Firebase JWT is secondary (mobile app only). Can't use Firebase Auth for MCP clients without custom token exchange.

Built by [Rezzed.ai](https://rezzed.ai)
