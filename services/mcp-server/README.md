# CacheBash MCP Server

Model Context Protocol server for multi-agent coordination. Provides 100+ tools across 23 modules with full MCP-REST parity. Auto-generated OpenAPI 3.0 spec at `/v1/openapi.json`.

## Architecture

```
                    +-----------------+
                    |   MCP Client    |
                    | (Any AI Agent)  |
                    +--------+--------+
                             |
                    Streamable HTTP (Bearer auth)
                             |
              +--------------+--------------+
              |      index.ts (842 lines)   |
              |  MCP Server + REST Router   |
              +------+------+------+-------+
                     |      |      |
         +-----------+   +--+--+  +--------+
         |               |     |           |
   +-----+-----+   +-----+-----+   +------+------+
   | Middleware |   | Transport |   |    Modules   |
   +-----+-----+   +-----------+   +------+-------+
         |          gate.ts              |
   apiKeyValidator  correlationId   dispatch (tasks + interventions + lineage)
   rateLimiter      SessionManager  relay (messages)
   dns-rebinding    MessageParser   pulse (sessions + fleet)
                    rest.ts         signal (questions)
                                    dream
                                    sprint
                                    gsp (state protocol)
                                    policy (governance engine)
                                    webhook (lifecycle subscriptions)
                                    openapi (spec generation)
                                    state (program memory)
                                    metrics (telemetry)
                                    keys (API key mgmt)
                                    programs (registry)
                                    audit (compliance)
                                    schedule (cron jobs)
                                    trace (debugging)
                                    pattern (knowledge)
                                    clu (analysis)
                                    feedback
                                    admin
                                    ledger
```

## Firestore Collections

Collections per tenant (`tenants/{userId}/...`):

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `tasks` | Unified work units | `type`, `status`, `priority`, `action` |
| `relay` | Ephemeral program messages | `source`, `target`, `message_type`, `expiresAt` |
| `sessions` | Live session tracking | `state`, `status`, `progress`, `lastHeartbeat` |
| `programs` | Program registry | `role`, `groups`, `tags`, `paused`, `quarantined` |
| `gsp/{namespace}/entries` | Grid State Protocol | `tier`, `value`, `version` |
| `telemetry_events` | Intervention + system events | `eventType`, `programId`, `taskId` |
| `audit` | Policy decisions + governance log | `event`, `program`, `policy`, `decision` |
| `rate_limit_events` | API throttle tracking (7-day TTL) | `modelTier`, `endpoint`, `backoffMs` |
| `ledger` | Cost/usage tracking | `tool`, `transport`, `durationMs`, `success` |
| `webhooks` | Webhook subscriptions | `callbackUrl`, `events`, `secret`, `enabled` |
| `webhook_deliveries` | Webhook delivery log | `webhookId`, `event`, `status`, `responseCode` |
| `program_stats` | Per-program success metrics | `taskTypeSuccessRates`, `avgDuration` |

### Task Schema (`tasks`)

Type discriminator determines sub-object:

| Type | Sub-object | Use |
|------|-----------|-----|
| `task` | — | General work items |
| `question` | `question: { content, options, response, answeredAt }` | Questions needing user response |
| `dream` | `dream: { agent, budget_cap_usd, branch, ... }` | Dream Mode sessions |
| `sprint` | `sprint: { projectName, branch, currentWave, config, summary }` | Sprint parent |
| `sprint-story` | `sprint: { parentId, storyId, wave, status, progress }` | Sprint child stories |

### Lifecycle States

```
created --> active --> completing --> done
   |          |                       |
   +---> blocked <---+          failed / archived
```

7 states: `created`, `active`, `blocked`, `completing`, `done`, `failed`, `archived`

### Envelope v2.1

All tasks include:
- `source`, `target` — program identity
- `priority` — low / normal / high
- `action` — interrupt / sprint / parallel / queue / backlog
- `ttl`, `expiresAt` — time-to-live
- `replyTo`, `threadId` — conversation threading
- `provenance` — `{ model, cost_tokens, confidence }`
- `fallback` — alternative target routing
- `stateTransitions` — array of `{ from, to, timestamp, actor, trigger }` lifecycle records
- `replayOf`, `retriedFrom`, `reassignedFrom`, `escalatedFrom` — lineage pointers
- `lineageRoot` — root task ID for lineage chains

## Auth

Bearer token authentication via `Authorization: Bearer <api-key>`.

API keys are stored in `users/{uid}/apiKeys/{keyHash}` with SHA-256 hashing. No query parameter auth (security requirement).

## MCP Tools (100+)

### Dispatch — Task Lifecycle (10 tools)
| Tool | Description |
|------|-------------|
| `get_tasks` | Get tasks filtered by status, type, target |
| `get_task_by_id` | Get a single task with full details |
| `create_task` | Create a new task with envelope fields |
| `claim_task` | Atomically claim a pending task (transaction) |
| `unclaim_task` | Return a claimed task to created status |
| `complete_task` | Mark a task as done/failed/skipped/cancelled |
| `batch_claim_tasks` | Claim multiple tasks in one call |
| `batch_complete_tasks` | Complete multiple tasks in one call |
| `get_contention_metrics` | Task claim contention stats |
| `dispatch` | Atomic dispatch with pre-flight, auto-wake, uptake verification |

### Dispatch — Interventions (10 tools)
| Tool | Description |
|------|-------------|
| `retry_task` | Reset a failed/done task for re-execution |
| `abort_task` | Cancel an active task |
| `reassign_task` | Move a task to a different target program |
| `escalate_task` | Escalate a task to a higher-tier program |
| `pause_program` | Pause a program (blocks new dispatches) |
| `resume_program` | Resume a paused program |
| `quarantine_program` | Isolate a program (auto-triggers at 3+ failures/hr) |
| `unquarantine_program` | Release a quarantined program |
| `replay_task` | Clone a task with modified instructions/target |
| `approve_task` | Approve a supervised-mode task completion |

### Dispatch — Lineage & Export (2 tools)
| Tool | Description |
|------|-------------|
| `get_task_lineage` | Query lineage chain — ancestors, descendants, and state transition log |
| `export_tasks` | Bulk export tasks with lineage fields, status/date filtering |

### Dispatch — Smart Dispatch (1 tool)
| Tool | Description |
|------|-------------|
| `suggest_target` | Rank programs by historical success rate for a given task type |

### Webhook — Lifecycle Subscriptions (4 tools)
| Tool | Description |
|------|-------------|
| `webhook_register` | Register a webhook for task lifecycle events (HMAC-SHA256 signed) |
| `webhook_list` | List webhook subscriptions (filterable by enabled status) |
| `webhook_delete` | Remove a webhook registration |
| `webhook_get_deliveries` | Get webhook delivery logs (filterable by status) |

### Policy — Governance Engine (6 tools)
| Tool | Description |
|------|-------------|
| `policy_create` | Create a governance policy (pattern/threshold/allowlist/denylist) |
| `policy_update` | Update policy rules, scope, or enforcement |
| `policy_delete` | Delete a policy |
| `policy_get` | Get a single policy by ID |
| `policy_list` | List policies with tier/enforcement/enabled filters |
| `policy_check` | Dry-run policy evaluation against a dispatch context |

### Relay (7 tools)
| Tool | Description |
|------|-------------|
| `send_message` | Send a message between programs (Relay v0.2) |
| `get_messages` | Get pending messages for a session/target |
| `send_directive` | Convenience wrapper for orchestrator→worker commands |
| `get_sent_messages` | Query a program's outbox |
| `get_dead_letters` | View failed delivery messages |
| `list_groups` | List multicast groups and members |
| `query_message_history` | Full message history with bodies |

### Pulse — Sessions & Fleet (7 tools)
| Tool | Description |
|------|-------------|
| `create_session` | Create/upsert a session |
| `update_session` | Update session status, state, progress, heartbeat |
| `list_sessions` | List sessions with state/program filters |
| `get_fleet_health` | Health status of all programs (heartbeat, pending work) |
| `get_fleet_timeline` | Historical fleet snapshots with configurable resolution |
| `write_fleet_snapshot` | Write a fleet health snapshot for time-series |
| `get_context_utilization` | Context window utilization time-series |

### Signal (3 tools)
| Tool | Description |
|------|-------------|
| `ask_question` | Send a question to user's mobile device |
| `get_response` | Check if user responded to a question |
| `send_alert` | Send one-way alert notification |

### Dream (2 tools)
| Tool | Description |
|------|-------------|
| `dream_peek` | Check for pending dream sessions |
| `dream_activate` | Atomically activate a dream session |

### Sprint (5 tools)
| Tool | Description |
|------|-------------|
| `create_sprint` | Create a sprint with stories and waves |
| `update_sprint_story` | Update story progress within a sprint |
| `add_story_to_sprint` | Dynamically add a story to a running sprint |
| `complete_sprint` | Mark a sprint as complete with summary |
| `get_sprint` | Get sprint state with stories and stats |

### GSP — Grid State Protocol (9 tools)
| Tool | Description |
|------|-------------|
| `gsp_read` | Read state entries by namespace/key/tier |
| `gsp_write` | Write operational state entries (atomic transactions) |
| `gsp_diff` | Diff state entries since a version or timestamp |
| `gsp_bootstrap` | Full agent boot context in one call |
| `gsp_seed` | Seed constitutional/architectural state (admin) |
| `gsp_propose` | Propose changes to constitutional/architectural state |
| `gsp_resolve` | Approve/reject governance proposals |
| `gsp_subscribe` | Subscribe to state change notifications |
| `gsp_search` | Search state entries by text query |

### State — Program Memory (8 tools)
| Tool | Description |
|------|-------------|
| `get_program_state` | Read a program's persistent operational state |
| `update_program_state` | Write program state (context summary, config, baselines) |
| `get_context_history` | Query timestamped context snapshots (shadow journal) |
| `store_memory` | Store a learned pattern into agent memory |
| `recall_memory` | Recall learned patterns with domain/text filters |
| `memory_health` | Memory health summary (pattern counts, domains, decay) |
| `delete_memory` | Hard-delete a learned pattern |
| `reinforce_memory` | Bump a pattern's confidence and timestamp |

### Metrics — Telemetry & Cost (5 tools)
| Tool | Description |
|------|-------------|
| `get_comms_metrics` | Relay message metrics by period |
| `get_cost_summary` | Cost/token spend aggregated by program or type |
| `get_operational_metrics` | Task success rates, latency, safety gate stats |
| `log_rate_limit_event` | Record a rate limit/throttle event |
| `get_rate_limit_events` | Query rate limit events with period/session filters |

### Keys (4 tools)
| Tool | Description |
|------|-------------|
| `create_key` | Create a per-program API key |
| `revoke_key` | Revoke an API key (soft revoke for audit) |
| `rotate_key` | Atomically rotate with 30s grace window |
| `list_keys` | List all API keys (metadata only, never raw keys) |

### Programs (2 tools)
| Tool | Description |
|------|-------------|
| `list_programs` | List registered programs (filter by role, group, active) |
| `update_program` | Update program metadata (display name, role, groups, tags) |

### Audit (2 tools)
| Tool | Description |
|------|-------------|
| `get_audit` | Query the Gate audit log |
| `get_ack_compliance` | ACK compliance report for directives |

### Schedule (5 tools)
| Tool | Description |
|------|-------------|
| `schedule_create` | Create a recurring cron schedule |
| `schedule_list` | List schedules (filter by target, enabled) |
| `schedule_get` | Get schedule with next/last run times |
| `schedule_update` | Update cron, budget cap, enable/disable |
| `schedule_delete` | Remove a schedule |

### Trace (2 tools)
| Tool | Description |
|------|-------------|
| `query_traces` | Query execution traces (filter by sprint, task, program) |
| `query_trace` | Reconstruct a complete agent trace by traceId |

### Pattern Consolidation (2 tools)
| Tool | Description |
|------|-------------|
| `pattern_consolidate` | Auto-promote patterns when N+ agents converge |
| `pattern_get_consolidated` | Retrieve promoted patterns from knowledge store |

### CLU — Analysis (3 tools)
| Tool | Description |
|------|-------------|
| `clu_ingest` | Ingest content (transcripts, URLs, text) for analysis |
| `clu_analyze` | Extract patterns, opportunities, gaps, blind spots |
| `clu_report` | Generate formatted reports from analysis results |

### Feedback (1 tool)
| Tool | Description |
|------|-------------|
| `submit_feedback` | Submit bug report/feature request (creates GitHub Issue) |

### Admin (1 tool)
| Tool | Description |
|------|-------------|
| `merge_accounts` | Merge alternate Firebase UID into canonical account |

## REST API

Every MCP tool has a corresponding REST endpoint. Bearer auth required on all.

### Dispatch
```
GET    /v1/tasks                         → get_tasks
GET    /v1/tasks/:id                     → get_task_by_id
POST   /v1/tasks                         → create_task
POST   /v1/tasks/:id/claim               → claim_task
POST   /v1/tasks/:id/unclaim             → unclaim_task
POST   /v1/tasks/:id/complete            → complete_task
POST   /v1/tasks/batch/claim             → batch_claim_tasks
POST   /v1/tasks/batch/complete          → batch_complete_tasks
GET    /v1/tasks/contention              → get_contention_metrics
POST   /v1/dispatch                      → dispatch
```

### Lineage & Smart Dispatch
```
GET    /v1/tasks/:id/lineage             → get_task_lineage
GET    /v1/tasks/export                  → export_tasks
GET    /v1/dispatch/suggest-target       → suggest_target
```

### Webhooks
```
POST   /v1/webhooks                      → webhook_register
GET    /v1/webhooks                      → webhook_list
DELETE /v1/webhooks/:id                  → webhook_delete
GET    /v1/webhook-deliveries            → webhook_get_deliveries
```

### OpenAPI
```
GET    /v1/openapi.json                  → Auto-generated OpenAPI 3.0 spec (public, cached 1hr)
```

### Interventions
```
POST   /v1/tasks/:id/retry               → retry_task
POST   /v1/tasks/:id/abort               → abort_task
POST   /v1/tasks/:id/reassign            → reassign_task
POST   /v1/tasks/:id/escalate            → escalate_task
POST   /v1/tasks/:id/approve             → approve_task
POST   /v1/tasks/:id/replay              → replay_task
POST   /v1/programs/:id/pause            → pause_program
POST   /v1/programs/:id/resume           → resume_program
POST   /v1/programs/:id/quarantine       → quarantine_program
POST   /v1/programs/:id/unquarantine     → unquarantine_program
```

### Policy
```
POST   /v1/policies                      → policy_create
GET    /v1/policies                      → policy_list
GET    /v1/policies/:id                  → policy_get
PATCH  /v1/policies/:id                  → policy_update
DELETE /v1/policies/:id                  → policy_delete
POST   /v1/policies/check               → policy_check
```

### Relay
```
GET    /v1/messages                      → get_messages
POST   /v1/messages                      → send_message
POST   /v1/messages/directive            → send_directive
GET    /v1/messages/sent                 → get_sent_messages
GET    /v1/messages/dead-letters         → get_dead_letters
GET    /v1/messages/groups               → list_groups
GET    /v1/messages/history              → query_message_history
```

### Pulse
```
GET    /v1/sessions                      → list_sessions
POST   /v1/sessions                      → create_session
PATCH  /v1/sessions/:id                  → update_session
GET    /v1/fleet/health                  → get_fleet_health
GET    /v1/fleet/timeline                → get_fleet_timeline
POST   /v1/fleet/snapshot                → write_fleet_snapshot
GET    /v1/fleet/context                 → get_context_utilization
```

### Signal
```
POST   /v1/questions                     → ask_question
GET    /v1/questions/:id/response        → get_response
POST   /v1/alerts                        → send_alert
```

### Sprint
```
POST   /v1/sprints                       → create_sprint
GET    /v1/sprints/:id                   → get_sprint
PATCH  /v1/sprints/:id/stories/:sid      → update_sprint_story
POST   /v1/sprints/:id/stories           → add_story_to_sprint
POST   /v1/sprints/:id/complete          → complete_sprint
```

### GSP
```
GET    /v1/gsp/:namespace                → gsp_read
POST   /v1/gsp/:namespace/:key           → gsp_write
GET    /v1/gsp/:namespace/diff           → gsp_diff
GET    /v1/gsp/bootstrap/:agentId        → gsp_bootstrap
POST   /v1/gsp/seed                      → gsp_seed
POST   /v1/gsp/propose                   → gsp_propose
POST   /v1/gsp/resolve                   → gsp_resolve
POST   /v1/gsp/subscribe                 → gsp_subscribe
GET    /v1/gsp/search                    → gsp_search
```

### Dream
```
GET    /v1/dreams                        → dream_peek
POST   /v1/dreams/:id/activate           → dream_activate
```

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-03-18T..." }
}
```

## REST Fallback (BUG-004)

MCP HTTP sessions may expire after extended periods. When this happens, programs should fall back to REST endpoints which provide full tool parity.

### Detection

Session death indicators:
- MCP POST returns HTTP 400 with JSON-RPC error code `-32001` (session expired)
- MCP POST returns HTTP 503 (service unavailable)
- Connection timeout or network error

### Recovery Pattern

```
1. Detect: MCP tool call fails with transport/session error
2. Probe:  GET /v1/health — verify server is alive
3. Retry:  Retry MCP call once (session may have recovered)
4. Fall back: Use equivalent REST endpoint with same Bearer auth
```

### Retry with Exponential Backoff

For transient errors (503, timeout):
```
Attempt 1: Wait 1s, retry
Attempt 2: Wait 2s, retry
Attempt 3: Wait 4s, retry
After 3 failures: Switch to REST fallback permanently for this session
```

### REST Request Format

```bash
# Example: send_message via REST
curl -X POST https://api.cachebash.dev/v1/messages \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"basher","target":"iso","message_type":"STATUS","message":"Using REST fallback"}'
```

## Cloud Functions

Triggers on v2 collection paths:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `onTaskCreate` | `tasks/{id}` onCreate | FCM push notifications |
| `onTaskUpdate` | `tasks/{id}` onUpdate | Status change notifications |
| `onSessionUpdate` | `sessions/{id}` onUpdate | Session state change handling |
| `cleanupExpiredSessions` | Scheduled | Archive stale sessions |
| `cleanupOrphanedTasks` | Scheduled | Clean up orphaned tasks |
| `cleanupExpiredRelay` | Scheduled | Delete expired relay messages |
| `cleanupLedger` | Scheduled | Prune old ledger entries |

## Running

```bash
cd mcp-server
npm install
npm run build
npm start          # Production (port 3001)
npm run dev        # Development with watch
npm test           # Run tests
```
