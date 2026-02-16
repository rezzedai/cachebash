# CacheBash MCP Server

Model Context Protocol server for the Grid. Provides 18 tools across 6 modules with full MCP-REST parity.

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
              |      index.ts (188 lines)   |
              |  MCP Server + REST Router   |
              +------+------+------+-------+
                     |      |      |
         +-----------+   +--+--+  +--------+
         |               |     |           |
   +-----+-----+   +-----+-----+   +------+------+
   | Middleware |   | Transport |   |    Modules   |
   +-----+-----+   +-----------+   +------+-------+
         |          gate.ts              |
   apiKeyValidator  correlationId   dispatch (tasks)
   rateLimiter      SessionManager  relay (messages)
   dns-rebinding    MessageParser   pulse (sessions)
                    rest.ts         signal (questions)
                                    dream
                                    sprint
                                    ledger
```

## Firestore Collections

4 collections per user (`users/{uid}/...`):

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `tasks` | Unified work units | `type`, `status`, `priority`, `action` |
| `relay` | Ephemeral program messages | `source`, `target`, `message_type`, `expiresAt` |
| `sessions` | Live session tracking | `state`, `status`, `progress`, `lastHeartbeat` |
| `ledger` | Cost/usage tracking | `tool`, `transport`, `durationMs`, `success` |

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
   +---> blocked <---+          failed / derezzed
```

7 states: `created`, `active`, `blocked`, `completing`, `done`, `failed`, `derezzed`

### Envelope v2.1

All tasks include:
- `source`, `target` — program identity
- `priority` — low / normal / high
- `action` — interrupt / sprint / parallel / queue / backlog
- `ttl`, `expiresAt` — time-to-live
- `replyTo`, `threadId` — conversation threading
- `provenance` — `{ model, cost_tokens, confidence }`
- `fallback` — alternative target routing

## Auth

Bearer token authentication via `Authorization: Bearer <api-key>`.

API keys are stored in `users/{uid}/apiKeys/{keyHash}` with SHA-256 hashing. No query parameter auth (security requirement).

## MCP Tools (18)

### Dispatch (4 tools)
| Tool | Description |
|------|-------------|
| `get_tasks` | Get tasks filtered by status, type, target |
| `create_task` | Create a new task with envelope fields |
| `claim_task` | Atomically claim a pending task (transaction) |
| `complete_task` | Mark a task as done |

### Relay (2 tools)
| Tool | Description |
|------|-------------|
| `send_message` | Send a message between programs (Grid Relay v0.2) |
| `get_messages` | Get pending messages for a session/target |

### Pulse (3 tools)
| Tool | Description |
|------|-------------|
| `create_session` | Create/upsert a session |
| `update_session` | Update session status, state, progress, heartbeat |
| `list_sessions` | List sessions with state/program filters |

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

### Sprint (4 tools)
| Tool | Description |
|------|-------------|
| `create_sprint` | Create a sprint with stories and waves |
| `update_sprint_story` | Update story progress within a sprint |
| `add_story_to_sprint` | Dynamically add a story to a running sprint |
| `complete_sprint` | Mark a sprint as complete with summary |

## REST API

Every MCP tool has a corresponding REST endpoint. Bearer auth required on all.

### Dispatch
```
GET    /v1/tasks                    → get_tasks
POST   /v1/tasks                    → create_task
POST   /v1/tasks/:id/claim          → claim_task
POST   /v1/tasks/:id/complete       → complete_task
```

### Relay
```
GET    /v1/messages                  → get_messages
POST   /v1/messages                  → send_message
```

### Pulse
```
GET    /v1/sessions                  → list_sessions
POST   /v1/sessions                  → create_session
PATCH  /v1/sessions/:id              → update_session
```

### Signal
```
POST   /v1/questions                 → ask_question
GET    /v1/questions/:id/response    → get_response
POST   /v1/alerts                    → send_alert
```

### Sprint
```
POST   /v1/sprints                   → create_sprint
PATCH  /v1/sprints/:id/stories/:sid  → update_sprint_story
POST   /v1/sprints/:id/stories       → add_story_to_sprint
POST   /v1/sprints/:id/complete      → complete_sprint
```

### Dream
```
GET    /v1/dreams                    → dream_peek
POST   /v1/dreams/:id/activate      → dream_activate
```

### Legacy Compat
```
GET    /v1/interrupts/peek           → get_messages (markAsRead: false)
GET    /v1/dreams/peek               → dream_peek
POST   /v1/dreams/activate           → dream_activate
```

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-02-14T..." }
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

### REST Endpoint Mapping

Every MCP tool has a REST equivalent:

| MCP Tool | REST Endpoint | Method |
|----------|--------------|--------|
| `get_tasks` | `/v1/tasks` | GET |
| `create_task` | `/v1/tasks` | POST |
| `claim_task` | `/v1/tasks/:id/claim` | POST |
| `complete_task` | `/v1/tasks/:id/complete` | POST |
| `send_message` | `/v1/messages` | POST |
| `get_messages` | `/v1/messages` | GET |
| `create_session` | `/v1/sessions` | POST |
| `update_session` | `/v1/sessions/:id` | PATCH |
| `list_sessions` | `/v1/sessions` | GET |
| `ask_question` | `/v1/questions` | POST |
| `get_response` | `/v1/questions/:id/response` | GET |
| `send_alert` | `/v1/alerts` | POST |
| `dream_peek` | `/v1/dreams` | GET |
| `dream_activate` | `/v1/dreams/:id/activate` | POST |

### REST Request Format

```bash
# Example: send_message via REST
curl -X POST https://cachebash-mcp-922749444863.us-central1.run.app/v1/messages \
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
