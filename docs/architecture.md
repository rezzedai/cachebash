# CacheBash Architecture

This document describes how CacheBash is built today. Each section names the source files it describes. Paths are relative to the repository root.

## System overview

CacheBash is the coordination layer for a fleet of AI agents. Agents call it to get work, hand off work, send messages, keep memory, and reach a person. It has five parts:

1. **MCP server** (`services/mcp-server/`). A Node.js service on Cloud Run. It serves 108 MCP tools in 21 domains, and a REST API over the same handlers.
2. **Firestore.** Each tenant's data sits under `tenants/{tenantId}/`. Key lookups and account links sit in a few top-level collections.
3. **Cloud Functions** (`services/functions/`). Push notifications, scheduled cleanup, dead-lettering, the Slack bridge, and key and sign-in helpers.
4. **Human surfaces.** The mobile app (`apps/mobile/`), the Slack bridge, webhooks, the REST API, and MCP chat clients.
5. **Infrastructure** (`infra/`). Firestore rules and indexes, and Terraform for two environments.

The MCP server is the only part agents talk to. It checks identity, permissions, limits and policy on every call before it touches data.

## Tool registry

Tools are defined per domain in `services/mcp-server/src/tools/*.ts`. `tools/index.ts` merges them into one list. Most tool names follow `<domain>_<action>`, for example `dispatch_create_task`.

How the count was made: one count of the entries in each file's exported `definitions` array, at the commit this document ships with. The result is 108 unique tool names. 21 files define at least one tool. `tools/usage.ts` has 3 handlers and an empty definitions list, so it adds no visible tools.

| Domain | Tools | Default profile | Lite profile |
|--------|------:|:---------------:|:------------:|
| dispatch | 24 | yes | yes |
| gsp | 9 | yes | yes |
| pulse | 9 | yes | yes |
| metrics | 8 | yes | yes |
| state | 8 | yes | yes |
| relay | 7 | yes | yes |
| policy | 6 | yes | yes |
| schedule | 5 | yes | no |
| sprint | 5 | yes | yes |
| keys | 4 | yes | yes |
| webhook | 4 | yes | yes |
| clu | 3 | yes | no |
| signal | 3 | yes | yes |
| audit | 2 | yes | yes |
| dream | 2 | yes | no |
| pattern | 2 | yes | no |
| programs | 2 | yes | yes |
| trace | 2 | yes | yes |
| admin | 1 | yes | yes |
| feedback | 1 | yes | yes |
| request_help | 1 | no | yes |
| **Total** | **108** | **107** | **96** |

The `CACHEBASH_PROFILE` environment variable picks the profile. `full` is the default. `lite` drops dream, schedule, clu, pattern and the hidden usage handlers, and adds `request_help`. `request_help` lets a tenant deployment send a help request to a home deployment over MCP (`modules/requestHelp.ts`).

Older flat tool names such as `create_task` and `send_message` still work. `tools/tool-aliases.ts` maps them to the canonical names before permission checks run.

## Request path

Every MCP tool call goes through the same steps, in this order (`services/mcp-server/src/index.ts`, `CallToolRequestSchema` handler):

1. **Sign-in.** The server validates the Bearer token on every HTTP request. It accepts three token types: Firebase ID tokens, API keys (`cb_` prefix) and OAuth access tokens (`cbo_` prefix). It rejects other prefixes. A tenant resolver maps alternate user IDs to one canonical tenant ID (`auth/authValidator.ts`, `auth/tenant-resolver.ts`).
2. **Rate limit.** Per key and per tenant (`middleware/rateLimiter.ts`).
3. **Permission check.** The key must hold the capability the tool needs (`middleware/capabilities.ts`).
4. **Write ceiling and kill switch.** Write calls only (`middleware/circuitBreaker.ts`).
5. **OAuth scope check.** OAuth tokens only (`oauth/scopes.ts`).
6. **Session compliance and usage-limit checks** (`middleware/sessionCompliance.ts`, `middleware/pricingEnforce.ts`).
7. **Handler.** The server adds trace IDs, runs the tool, then writes the audit entry, the trace and usage counters.

The REST API runs steps 2 to 4 and the compliance check through the same functions (`transport/rest.ts`, `callTool`).

A second MCP endpoint, `/v1/iso/mcp`, serves a fixed short list of tools for chat apps (`iso/isoServer.ts`, `iso/toolDefinitions.ts`).

## Identity and access

### API keys

- Keys are stored by SHA-256 hash in `keyIndex/{hash}`. The raw key is shown once at creation.
- A key record holds the tenant, the program ID, a capability list, and optional `active`, `revokedAt`, `expiresAt` and rate-limit tier fields. A key with `active: false` or a `revokedAt` value fails sign-in on its next request.
- Rotation creates a new key and gives the old key a 30-second grace window (`modules/keys.ts`).

### Capabilities

- Capabilities are `module.action` strings such as `dispatch.read` or `relay.write`. The wildcard `*` grants everything except `keys.provision`, which must be granted by name (`middleware/capabilities.ts`, `auth/ownerAuthz.ts`).
- Every tool maps to one required capability in `TOOL_CAPABILITIES`. A tool with no mapping is hidden from, and refused to, every key without `*`.
- `tools/list` returns only the tools a key may call. The server checks the capability again on each call.
- A key with no capability list gets its role's default set. An unknown role gets a restricted `default` set.
- A least-privilege preset allows task, message and question tools plus a few reads. It has no access to keys, admin, fleet control, policy, audit, shared-rule writes, state writes or program writes.

### Identity binding

- In the default `key_identity` auth mode, the key alone decides who the caller is. The `X-Program-Id` header cannot change it (`auth/authValidator.ts`).
- Tasks, messages, state and shared-state writes check the claimed `source` against the key's own program ID. A mismatch is refused (`middleware/gate.ts`, `verifySource`).

### Other sign-in paths

- **Firebase Auth** for mobile app users. Cloud Functions exchange GitHub and Google sign-in codes (`services/functions/src/auth/`).
- **OAuth 2** for MCP clients that use it. The server publishes OAuth metadata, supports dynamic client registration, and accepts the authorization code, refresh token and client credentials grants (`oauth/`). The lite profile does not advertise OAuth.

### Encryption

Question text, answer choices and question context can be encrypted with AES-256-CBC. The key is derived from the caller's API key with PBKDF2 (100,000 rounds, SHA-256). Questions are encrypted by default (`encryption/crypto.ts`, `modules/signal.ts`). Messages are stored unencrypted.

## Tasks

- **Lifecycle.** A task has seven states: created, active, blocked, completing, done, failed, archived. `lifecycle/engine.ts` lists the allowed moves and refuses the rest.
- **Claim.** A claim reads and writes the task inside one Firestore transaction. Two agents cannot both claim it. A repeat claim by the same session or program is treated as already claimed (`modules/dispatch/claims.ts`).
- **Dispatch.** `dispatch_dispatch` checks the target's heartbeat, can trigger a wake-up, evaluates policy, creates the task, sends a directive, and polls until the task is claimed or times out (`modules/dispatch/dispatchHandler.ts`).
- **Interventions.** Retry, abort, reassign, escalate, replay and approve run in transactions (`modules/dispatch/interventions.ts`).
- **Lineage.** New tasks made by retry, reassign, escalate or replay carry a link field back to the original. `dispatch_get_task_lineage` follows those links both ways (`modules/dispatch/lineage.ts`).
- **Expiry.** Expired tasks are removed by a tool and by a scheduled function (`modules/dispatch/reapExpiredTasks.ts`, `services/functions/src/cleanup/reapExpiredByTTL.ts`).

## Messages

- Direct messages go to one program. A group name such as `council`, `builders` or `all` fans out to its members (`config/programs.ts`, `modules/relay.ts`).
- Unknown targets are refused, so a send to a typo does not report success.
- An optional idempotency key makes a repeat send return the first result for one hour.
- Each message has a time limit, 24 hours by default (`config/constants.ts`). A message still unread after it expires is marked `dead_lettered` in place. `relay_get_dead_letters` lists these (`services/functions/src/cleanup/processDeadLetters.ts`). Dead-lettered messages are removed 7 days after expiry (`cleanupExpiredRelay.ts`).
- History tools return sent messages and past threads.

## Questions and approvals

- `signal_ask_question` stores a question with up to five choices as a task of type `question`. `signal_get_response` returns the answer (`modules/signal.ts`).
- `signal_send_alert` sends a short-lived alert.
- A task dispatched with `policy_mode: "supervised"` is set to `awaitingApproval` when the agent completes it, and stays at `completing`. `dispatch_approve_task` moves it to `done` and records who approved it (`modules/dispatch/completion.ts`, `modules/dispatch/interventions.ts`).

## Memory and shared state

- **Program state.** Each program has a state record at `tenants/{tenantId}/sessions/_meta/program_state/{programId}` with a context summary, learned patterns and stored memories. Tools store, recall, reinforce and delete memories and read context history (`modules/programState.ts`).
- **Grid State Protocol (GSP).** Shared entries at `tenants/{tenantId}/gsp/{namespace}/entries/{key}`, each with a version and the program that last wrote it. Entries sit in three tiers. Constitutional entries are synced from git and cannot be changed with `gsp_write`. Architectural entries are protected. Operational entries are open to normal reads and writes. Changes can be proposed and resolved. `gsp_bootstrap` returns a program's starting context in one call (`modules/gsp.ts`).
- **Memory decay.** A nightly function computes which stale patterns it would remove. It runs in dry-run mode: it logs the actions and changes nothing (`services/functions/src/cleanup/decayProgramState.ts`).

## Safety rails

### Policy check before dispatch

Policies are stored per tenant and evaluated before `dispatch` creates a task. Each policy has one enforcement: `warn`, `block` or `require_approval`. A `block` match stops the dispatch. `warn` and `require_approval` matches come back as warnings. With `policy_mode: "strict"`, any warning stops the dispatch (`modules/policy.ts`, `modules/dispatch/dispatchHandler.ts`).

### Write ceilings and kill switch

- The server counts write calls per key and per tenant in a rolling window. The counts come from the authenticated request, never from a value the agent sends (`middleware/circuitBreaker.ts`).
- A write is any tool whose capability ends in `.write`, plus `fleet.control` tools and `metrics_log_rate_limit_event`.
- Each tenant's limits live in `tenants/{tenantId}/_meta/ceilings` as `perKeyLimit`, `orgLimit`, `windowMs` and `paused`. Seed values for new tenants are 30 per key and 150 per tenant per 60 seconds.
- Setting `paused: true` stops every write for the tenant on the next request. The server reads this setting fresh on every write call.
- If the ceiling record is missing, malformed or unreadable, writes are refused. Reads never touch this check.

### Rate limits

Limits use a 60-second sliding window (`config/rateLimits.ts`).

| Scope | Limit |
|-------|-------|
| Per key, default tier | 60 requests per minute, plus 10 burst |
| Per key, other tiers | 300 or 600 per minute, set on the key record |
| Per tenant, all keys | 1,200 per minute |
| Failed sign-ins, per IP | 60 per minute |

A refused call returns a retry time.

### Program controls

Operators can pause, resume, quarantine and unquarantine a program. `dispatch` warns when the target is paused or quarantined (`modules/pulse.ts`, `modules/dispatch/interventions.ts`).

## Audit and telemetry

- **Audit.** Each tool call, and each refusal by the permission or ceiling checks, writes an entry with the tool, program, endpoint, result and a correlation ID. Entries go to `tenants/{tenantId}/ledger` with `type: "audit"`. `audit_get_audit` reads them (`middleware/gate.ts`, `modules/audit.ts`).
- **Per-task telemetry.** Task completion records status, model, provider, input and output tokens, cost in USD, an error code and an error class (TRANSIENT, PERMANENT, DEPENDENCY, POLICY, TIMEOUT or UNKNOWN) (`modules/dispatch/completion.ts`).
- **Traces.** Every call gets a trace ID and span ID. `trace_query_traces` reads them (`modules/trace.ts`).
- **Metrics.** Cost summary and forecast, comms and operational metrics, SLA compliance and rate-limit events (`modules/metrics.ts`).

## Data layout

Tenant data (`infra/firestore.rules` and the modules above):

| Path under `tenants/{tenantId}/` | Contents |
|------|----------|
| `tasks/` | Tasks and questions |
| `relay/` | Messages, including dead-lettered ones |
| `sessions/` | Agent sessions and heartbeats |
| `sessions/_meta/program_state/` | Per-program state and memory |
| `gsp/{namespace}/entries/` | Shared state |
| `programs/` | Registered programs |
| `ledger/` | Audit entries and cost records |
| `_meta/ceilings` | Write ceilings and kill switch |
| `usage/`, `rate_limit_events/` | Usage counters and throttle records |
| `idempotency_keys/` | Message idempotency records |

Top-level collections include `keyIndex/` (API key hashes) and `canonical_accounts/` (account links).

## Cloud Functions

Source: `services/functions/src/`, exported from `index.ts`.

| Function | Trigger | Purpose |
|----------|---------|---------|
| `onTaskCreate`, `onTaskUpdate` | Task write | Push notifications to the mobile app |
| `onRelayCreate` | Message write | Push notifications to the mobile app |
| `onSessionUpdate` | Session write | Push notifications on session changes |
| `onSlackBridge` | Message to `slack-bridge` | Post the message to a Slack channel, at most 30 per hour |
| `processDeadLetters` | Every 15 minutes | Mark expired unread messages dead-lettered |
| `cleanupExpiredRelay` | Every 15 minutes | Remove old delivered and dead-lettered messages |
| `reapExpiredByTTL` | Every 15 minutes | Delete tasks and proposals past their time limit |
| `cleanupExpiredSessions`, `cleanupOrphanedTasks` | Every 5 minutes | Archive sessions with no heartbeat for 65 minutes; return active tasks with no heartbeat for 30 minutes to `created` |
| `cleanupLedger`, `cleanupAudit` | Every 24 hours | Prune old ledger and audit records |
| `decayProgramState` | Every 24 hours | Memory decay, dry-run only |
| `createUserKey`, `revokeUserKey`, `rotateApiKey`, `updateKeyLabel` | Callable | Key management from the mobile app |
| `cliAuthApprove`, `cliAuthStatus` | Callable | Browser sign-in for `npx @rezzed.ai/cachebash init` |

The same file also exports analytics, pattern, usage, feedback and build functions.

## Human surfaces

- **Mobile app** (`apps/mobile/`, React Native and Expo). Screens for tasks and questions, messages, fleet health, sprints, programs, keys and usage. People answer questions from the task detail screen.
- **Slack bridge.** A message sent to the target `slack-bridge` is posted to a Slack channel (`services/functions/src/notifications/onSlackBridge.ts`).
- **Webhooks.** Registered URLs receive task events. A payload is signed with HMAC-SHA256 when the webhook has a secret (`modules/webhook.ts`, `modules/webhookDispatcher.ts`).
- **REST API.** The same operations over plain HTTP with the same Bearer auth (`transport/rest.ts`). See [api-reference.md](api-reference.md).
- **MCP chat clients.** Clients can sign in with OAuth, or use the `/v1/iso/mcp` endpoint.

## REST and MCP response shapes

Every operation is reachable through two transports. Their response envelopes differ.

| Transport | Endpoint | Response shape |
|-----------|----------|----------------|
| MCP | `POST /v1/mcp` | Raw tool result: `{success: true, tasks: [...]}` |
| REST | `/v1/{resource}` | Wrapped: `{success: true, data: {...}, meta: {timestamp}}` |

REST clients must read `response.data` to get the MCP-equivalent payload.

```typescript
// MCP client (raw)
const result = await mcpClient.callTool("get_tasks", { status: "created" });
console.log(result.tasks);

// REST client (envelope)
const res = await fetch("/v1/tasks", { headers });
const json = await res.json();
console.log(json.data.tasks);
```

## Infrastructure

Terraform lives in `infra/terraform/`. It manages APIs, Firestore creation, Cloud Run scaling and IAM, service accounts and Cloud Scheduler jobs. Code deploys run separately with `gcloud run deploy --source .` (`infra/terraform/README.md`).

There are two environments in `infra/terraform/envs/`:

- **Main environment** (`cachebash-app`). Cloud Run service `cachebash-mcp` on port 3001, 0 to 10 instances, 3600-second request timeout, default region `us-central1`. Six Cloud Scheduler jobs call the server's internal endpoints: wake daemon, TTL reaper, GitHub reconcile, health check, stale sessions and scheduled work.
- **Tenant environment.** One Cloud Run service with `CACHEBASH_PROFILE=lite`, 0 to 2 instances. Traffic reaches it only through an external HTTPS load balancer, with Cloud Armor rules and a managed TLS certificate.

Cloud Run allows unauthenticated invocation in both environments. CacheBash checks every request itself.

`GET /v1/health` returns `status: "ok"`, the server version, build identity and a list of endpoints. It does not test Firestore.

## Known limitations

1. **Messages are not encrypted at field level.** Only questions are. Programs need to read message fields for routing.
2. **Idle MCP sessions expire after one hour.** Clients can fall back to REST with the same key.
3. **Memory decay is dry-run.** It logs what it would remove and removes nothing.

Built by [Rezzed.ai](https://rezzed.ai)
