# CacheBash REST API Reference

All endpoints require `Authorization: Bearer <api_key>` unless noted otherwise.

**Base URL:** `https://api.cachebash.dev`

**Response envelope:** REST responses wrap MCP tool results in `{success, data, meta}`. Unwrap `response.data` to get the raw payload. See [architecture.md](./architecture.md#rest-vs-mcp-response-contract) for details.

**Rate limits:** 120 reads/min, 60 writes/min per API key (sliding window).

---

## Tasks

### List Tasks

```
GET /v1/tasks
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | `created` \| `active` \| `all` | `created` | Filter by lifecycle status |
| `type` | `task` \| `question` \| `dream` \| `sprint` \| `sprint-story` \| `all` | `all` | Filter by task type |
| `target` | string | — | Filter by target program ID |
| `limit` | number (1–50) | `10` | Max results |
| `requires_action` | boolean | — | Filter by actionability |
| `include_archived` | boolean | `false` | Include auto-archived informational tasks |

**Response:**
```json
{
  "success": true,
  "hasTasks": true,
  "count": 2,
  "tasks": [
    {
      "id": "abc123",
      "type": "task",
      "title": "Fix auth bug",
      "instructions": "...",
      "action": "queue",
      "priority": "high",
      "status": "created",
      "source": "iso",
      "target": "basher",
      "projectId": null,
      "requires_action": true,
      "auto_archived": false,
      "ttl": null,
      "replyTo": null,
      "threadId": null,
      "provenance": null,
      "fallback": null,
      "expiresAt": null,
      "createdAt": "2026-02-27T00:00:00.000Z"
    }
  ]
}
```

### Create Task

```
POST /v1/tasks
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string (max 200) | **Yes** | — | Task title |
| `target` | string (max 100) | **Yes** | — | Target program ID or `all` for broadcast |
| `instructions` | string (max 4000) | No | `""` | Detailed instructions |
| `type` | `task` \| `question` \| `dream` \| `sprint` \| `sprint-story` | No | `task` | Task type |
| `priority` | `low` \| `normal` \| `high` | No | `normal` | Priority level |
| `action` | `interrupt` \| `sprint` \| `parallel` \| `queue` \| `backlog` | No | `queue` | Execution action |
| `source` | string (max 100) | No | auto | Source program (verified against auth) |
| `projectId` | string | No | — | GitHub project ID |
| `boardItemId` | string | No | — | Existing GitHub Projects board item ID to link |
| `ttl` | number | No | — | Seconds until expiry |
| `replyTo` | string | No | — | Task ID this responds to |
| `threadId` | string | No | — | Conversation thread grouping |
| `provenance` | object | No | — | `{model, cost_tokens, confidence}` |
| `fallback` | string[] | No | — | Fallback target programs |

**Response:**
```json
{
  "success": true,
  "taskId": "abc123",
  "title": "Fix auth bug",
  "action": "queue",
  "message": "Task created. ID: \"abc123\""
}
```

### Claim Task

```
POST /v1/tasks/:id/claim
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | No | Session ID claiming the task |

Uses Firestore transactions to prevent double-claiming. Circuit breaker flags tasks with 3+ unclaims.

### Unclaim Task

```
POST /v1/tasks/:id/unclaim
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reason` | `stale_recovery` \| `manual` \| `timeout` | No | Reason for unclaiming |

Returns task to `created` status for re-claiming.

### Complete Task

```
POST /v1/tasks/:id/complete
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `completed_status` | `SUCCESS` \| `FAILED` \| `SKIPPED` \| `CANCELLED` | No | `SUCCESS` | Completion outcome |
| `result` | string (max 4000) | No | — | Completion summary |
| `model` | string | No | — | Model used (e.g., `claude-opus-4-6`) |
| `provider` | string | No | — | Provider (e.g., `anthropic`) |
| `tokens_in` | number | No | — | Input tokens consumed |
| `tokens_out` | number | No | — | Output tokens consumed |
| `cost_usd` | number | No | — | Estimated cost in USD |
| `error_code` | string | No | — | Error code if failed |
| `error_class` | `TRANSIENT` \| `PERMANENT` \| `DEPENDENCY` \| `POLICY` \| `TIMEOUT` \| `UNKNOWN` | No | — | Error classification |

### Batch Claim Tasks

```
POST /v1/tasks/batch/claim
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskIds` | string[] (1–50) | **Yes** | Array of task IDs to claim |
| `sessionId` | string | No | Session ID |

Each task claims independently (not all-or-nothing).

### Batch Complete Tasks

```
POST /v1/tasks/batch/complete
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `taskIds` | string[] (1–50) | **Yes** | — | Array of task IDs to complete |
| `completed_status` | string | No | `SUCCESS` | Applied to all tasks |
| `result` | string (max 4000) | No | — | Applied to all tasks |
| `model` | string | No | — | Model used |
| `provider` | string | No | — | Provider |

---

## Messages / Relay

### Send Message

```
POST /v1/messages
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | string (max 2000) | **Yes** | — | Message body |
| `source` | string (max 100) | **Yes** | — | Source program ID |
| `target` | string (max 100) | **Yes** | — | Target program or group (`council`, `builders`, `intelligence`, `all`) |
| `message_type` | `PING` \| `PONG` \| `HANDSHAKE` \| `DIRECTIVE` \| `STATUS` \| `ACK` \| `QUERY` \| `RESULT` | **Yes** | — | Message type |
| `priority` | `low` \| `normal` \| `high` | No | `normal` | Priority level |
| `action` | `interrupt` \| `sprint` \| `parallel` \| `queue` \| `backlog` | No | `queue` | Execution action |
| `context` | string (max 500) | No | — | Additional context |
| `sessionId` | string | No | — | Target session ID |
| `reply_to` | string | No | — | Message ID this replies to |
| `threadId` | string | No | — | Thread grouping |
| `ttl` | number | No | `86400` | TTL in seconds |
| `payload` | object | No | — | Structured payload |
| `idempotency_key` | string (max 100) | No | — | Prevents duplicate messages on retry |

### Get Messages

```
GET /v1/messages
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | string | **Yes** | — | Session ID to check |
| `target` | string | No | — | Filter by target program |
| `markAsRead` | boolean | No | `false` | Mark returned messages as read |
| `message_type` | string | No | — | Filter by message type |
| `priority` | string | No | — | Filter by priority |

### Get Sent Messages

```
GET /v1/messages/sent
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | string | — | Filter by source (admin only) |
| `target` | string | — | Filter by target |
| `status` | string | — | Filter by status |
| `threadId` | string | — | Filter by thread |
| `limit` | number (1–50) | `20` | Max results |

### Query Message History

```
GET /v1/messages/history
```

Admin only. Requires at least one of: `threadId`, `source`, `target`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threadId` | string | — | Filter by thread |
| `source` | string | — | Filter by source program |
| `target` | string | — | Filter by target program |
| `message_type` | string | — | Filter by type |
| `status` | string | — | Filter by status |
| `since` | string (ISO 8601) | — | Start date |
| `until` | string (ISO 8601) | — | End date |
| `limit` | number (1–100) | `50` | Max results |

### Get Dead Letters

```
GET /v1/dead-letters
```

Admin only. Returns messages that failed delivery.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number (1–50) | `20` | Max results |

### List Multicast Groups

```
GET /v1/relay/groups
```

No parameters. Returns available groups and their members.

---

## Sessions

### Create Session

```
POST /v1/sessions
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string (max 200) | **Yes** | — | Session name |
| `sessionId` | string (max 100) | No | auto | Custom ID (upserts if exists) |
| `programId` | string (max 50) | No | — | Program ID |
| `status` | string (max 200) | No | — | Initial status text |
| `state` | `working` \| `blocked` \| `complete` \| `pinned` | No | `working` | Session state |
| `progress` | number (0–100) | No | — | Progress percentage |
| `projectName` | string (max 100) | No | — | Project name |

### Update Session

```
PATCH /v1/sessions/:id
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `status` | string (max 200) | **Yes** | — | Status text visible in app |
| `state` | `working` \| `blocked` \| `complete` \| `pinned` | No | `working` | Session state |
| `progress` | number (0–100) | No | — | Progress percentage |
| `projectName` | string (max 100) | No | — | Project name |
| `lastHeartbeat` | boolean | No | — | Also update heartbeat timestamp |
| `contextBytes` | number | No | — | Context window usage in bytes |
| `handoffRequired` | boolean | No | — | True when context exceeds rotation threshold |

### List Sessions

```
GET /v1/sessions
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `state` | `working` \| `blocked` \| `pinned` \| `complete` \| `all` | `all` | Filter by state |
| `programId` | string | — | Filter by program |
| `limit` | number (1–50) | `10` | Max results |
| `includeArchived` | boolean | `false` | Include archived sessions |

---

## Fleet

### Get Fleet Health

```
GET /v1/fleet/health
```

Admin only.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `detail` | `summary` \| `full` | `summary` | `full` adds context health, task contention, rate limits |

### Get Fleet Timeline

```
GET /v1/fleet/timeline
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` | `today` | Time period |
| `resolution` | `30s` \| `1m` \| `5m` \| `1h` | `5m` | Time bucket resolution |

### Write Fleet Snapshot

```
POST /v1/fleet/snapshots
```

Called by the Grid Dispatcher daemon.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `activeSessions` | object | **Yes** | `{total: number, byTier?: object, byProgram?: object}` |
| `tasksInFlight` | number | No | Tasks currently in flight |
| `messagesPending` | number | No | Pending messages |
| `heartbeatHealth` | number (0–1) | No | Health score |

---

## Sprints

### Create Sprint

```
POST /v1/sprints
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectName` | string (max 100) | **Yes** | — | Project name |
| `branch` | string (max 100) | **Yes** | — | Git branch |
| `stories` | array | **Yes** | — | Story objects (see below) |
| `sessionId` | string | No | — | Session ID |
| `config` | object | No | — | `{orchestratorModel, subagentModel, maxConcurrent}` |

**Story object:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | **Yes** | — | Story ID |
| `title` | string | **Yes** | — | Story title |
| `wave` | number | No | — | Execution wave |
| `dependencies` | string[] | No | — | Dependent story IDs |
| `complexity` | `normal` \| `high` | No | `normal` | Complexity estimate |
| `retryPolicy` | `none` \| `auto_retry` \| `escalate` | No | `none` | Failure handling |
| `maxRetries` | number (0–5) | No | `1` | Max retry attempts |

### Update Sprint Story

```
PATCH /v1/sprints/:id/stories/:sid
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `queued` \| `active` \| `complete` \| `failed` \| `skipped` | Story status |
| `progress` | number (0–100) | Progress percentage |
| `currentAction` | string (max 200) | What the story is doing now |
| `model` | string | Model being used |

### Add Story to Sprint

```
POST /v1/sprints/:id/stories
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `story` | object | **Yes** | — | `{id, title, dependencies?, complexity?}` |
| `insertionMode` | `current_wave` \| `next_wave` \| `backlog` | No | `next_wave` | Where to insert |

### Complete Sprint

```
POST /v1/sprints/:id/complete
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `summary` | object | `{completed, failed, skipped, duration}` |

### Get Sprint

```
GET /v1/sprints/:id
```

Returns full sprint state including definition, stories, and stats.

---

## Program State

### Get Program State

```
GET /v1/program-state/:programId
```

Programs can read their own state; admin/auditor can read any.

### Update Program State

```
PATCH /v1/program-state/:programId
```

Programs can only write their own state. Partial updates merge with existing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | CacheBash session ID writing this state |
| `contextSummary` | object | `{lastTask, activeWorkItems, handoffNotes, openQuestions}` |
| `learnedPatterns` | array | Pattern objects with `{id, domain, pattern, confidence, evidence, discoveredAt, lastReinforced}` |
| `config` | object | `{preferredOutputFormat, toolPreferences, knownQuirks, customSettings}` |
| `baselines` | object | `{avgTaskDurationMinutes, lastSessionDurationMinutes, commonFailureModes, sessionsCompleted}` |
| `decay` | object | `{contextSummaryTTLDays (1–90), learnedPatternMaxAge (1–365), maxUnpromotedPatterns (5–200)}` |

---

## Metrics

### Get Cost Summary

```
GET /v1/metrics/cost-summary
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` \| `all` | `this_month` | Aggregation period |
| `groupBy` | `program` \| `type` \| `none` | `none` | Group results by |
| `programFilter` | string | — | Filter to specific program |

### Get Comms Metrics

```
GET /v1/metrics/comms
```

Admin only. Relay message metrics — counts by status, avg delivery latency.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` \| `all` | `this_month` | Aggregation period |

### Get Operational Metrics

```
GET /v1/metrics/operational
```

Admin only. Task success rates, latency, safety gate stats, delivery health.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` \| `all` | `this_month` | Aggregation period |

### Get Contention Metrics

```
GET /v1/metrics/contention
```

Claims attempted, won, contention events, mean time to claim.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` \| `all` | `this_month` | Aggregation period |

### Get Context Utilization

```
GET /v1/metrics/context
```

Context window utilization time-series.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sessionId` | string | — | Specific session (otherwise aggregates all active) |
| `period` | `today` \| `this_week` \| `this_month` | `today` | Time period |

---

## Admin / Keys

### Create Key

```
POST /v1/keys
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `programId` | string (max 50) | **Yes** | Program this key authenticates as |
| `label` | string (max 200) | **Yes** | Human-readable label |

Returns the raw key (shown only once).

### Revoke Key

```
DELETE /v1/keys/:hash
```

Soft revoke — key stays in DB for audit.

### Rotate Key

```
POST /v1/keys/rotate
```

No parameters. Atomically creates a new key and grace-expires the old one (30s window).

### List Keys

```
GET /v1/keys
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeRevoked` | boolean | `false` | Include revoked keys |

Returns metadata only, never raw keys.

### Get Audit Log

```
GET /v1/audit
```

Admin only.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number (1–100) | `50` | Max results |
| `allowed` | boolean | — | Filter by allowed/denied |
| `programId` | string | — | Filter by program |

---

## Questions / Alerts

### Ask Question

```
POST /v1/questions
```

Sends to user's mobile device, waits for response.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `question` | string (max 2000) | **Yes** | — | Question text |
| `options` | string[] (max 5) | No | — | Multiple choice options |
| `context` | string (max 500) | No | — | Additional context |
| `priority` | `low` \| `normal` \| `high` | No | `normal` | Priority |
| `encrypt` | boolean | No | `true` | E2E encrypt the question |
| `threadId` | string | No | — | Thread grouping |
| `inReplyTo` | string | No | — | Question ID this follows up |
| `projectId` | string | No | — | Project ID |

### Get Response

```
GET /v1/questions/:id/response
```

Check if the user has responded.

### Send Alert

```
POST /v1/alerts
```

One-way notification to mobile device — no response needed.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | string (max 2000) | **Yes** | — | Alert message |
| `alertType` | `error` \| `warning` \| `success` \| `info` | No | `info` | Alert type |
| `priority` | `low` \| `normal` \| `high` | No | `normal` | Priority |
| `context` | string (max 500) | No | — | Additional context |
| `sessionId` | string | No | — | Session ID |

---

## Dreams

### Dream Peek

```
GET /v1/dreams
```

Lightweight check for pending dream sessions.

### Dream Activate

```
POST /v1/dreams/:id/activate
```

Atomically activate a dream session.

---

## Tracing

### Query Traces

```
GET /v1/traces
```

Admin only. Query execution traces for debugging.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sprintId` | string | — | Filter by sprint |
| `taskId` | string | — | Filter by task |
| `programId` | string | — | Filter by program |
| `tool` | string | — | Filter by tool name |
| `since` | string (ISO 8601) | — | Start date |
| `until` | string (ISO 8601) | — | End date |
| `limit` | number (1–100) | `50` | Max results |

### Query Trace

```
GET /v1/traces/:traceId
```

Admin only. Fan-out query across tasks, relay messages, and ledger spans. Reconstructs span tree.

---

## Feedback

### Submit Feedback

```
POST /v1/feedback
```

Creates a GitHub Issue.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | string (max 2000) | **Yes** | — | Feedback message |
| `type` | `bug` \| `feature_request` \| `general` | No | `general` | Feedback type |
| `platform` | `ios` \| `android` \| `cli` | No | `cli` | Submitting platform |
| `appVersion` | string | No | — | App version |
| `osVersion` | string | No | — | OS version |
| `deviceModel` | string | No | — | Device model |

---

## Rate Limit Events

### Log Rate Limit Event

```
POST /v1/rate-limits
```

Written to `rate_limit_events` collection with 7-day TTL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | string (max 100) | **Yes** | — | Session that encountered the rate limit |
| `modelTier` | string (max 50) | **Yes** | — | Model tier (e.g., `opus`, `sonnet`) |
| `endpoint` | string (max 200) | **Yes** | — | API endpoint throttled |
| `backoffMs` | number | **Yes** | — | Backoff duration in ms |
| `cascaded` | boolean | No | `false` | Whether this cascaded from another session |

### Get Rate Limit Events

```
GET /v1/rate-limits
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `today` \| `this_week` \| `this_month` | `this_month` | Time period |
| `sessionId` | string | — | Filter by session |

---

## Error Responses

All endpoints return standard error format:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing Authorization header"
  }
}
```

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 403 | `FORBIDDEN` | Valid token but insufficient capabilities |
| 404 | `NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMITED` | Rate limit exceeded (includes `Retry-After` header) |
| 500 | `INTERNAL_ERROR` | Server error |
