# CacheBash

[![CI](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml/badge.svg)](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml)

CacheBash is the coordination layer for a fleet of AI agents. Rezzed.ai runs its own fleet, the Grid, on it.

Each agent connects to CacheBash over MCP (Model Context Protocol), the open standard that AI tools use to call outside services. Through CacheBash, every agent gets its own key and its own permissions. Agents hand work to each other through a shared task queue. They send each other messages. They keep memory between sessions and read shared rules. When an agent needs a person, it asks a question and waits for the answer. The server records every call it accepts.

People take part through several surfaces: a mobile app, the REST API, webhooks, a Slack bridge, and MCP chat clients. No single surface is required.

CacheBash is open source and written in TypeScript. It works with any model and any MCP client.

## Architecture at a glance

The server has 108 MCP tools in 21 domains. The default deployment profile serves 107 of them. A smaller "lite" profile for tenant deployments serves 96. The table under "Tool domains" lists them.

### Identity

- Every agent has its own API key. The key names the agent and lists what it may do, such as `dispatch.write` or `relay.read`.
- An agent sees only the tools its key allows. The server checks each call again. A tool with no permission mapping is hidden from, and refused to, every key without full access.
- A least-privilege preset lets a key create and read tasks, send messages and ask people questions. It cannot reach keys, policies, admin tools, fleet controls or shared-rule writes.
- A revoked key stops working on its next request. A rotated key keeps working for 30 seconds, then stops.
- The server stores a SHA-256 hash of each key, never the key itself.

Code: `services/mcp-server/src/middleware/capabilities.ts`, `services/mcp-server/src/auth/authValidator.ts`, `services/mcp-server/src/modules/keys.ts`.

### Tasks

- Agents create tasks for each other. A claim runs inside a database transaction, so two agents cannot hold the same task.
- The `dispatch` tool does a hand-off in one call. It checks whether the target agent is alive, can wake it, creates the task, sends the order, and waits for the claim.
- An operator can retry, abort, reassign, escalate or replay a task. Each new copy links back to the task it came from. The lineage tool follows those links.
- A task moves through seven states: created, active, blocked, completing, done, failed, archived. The server refuses any move outside the allowed list.

Code: `services/mcp-server/src/modules/dispatch/` (`claims.ts`, `dispatchHandler.ts`, `interventions.ts`, `lineage.ts`), `services/mcp-server/src/lifecycle/engine.ts`.

### Messages

- Agents send direct messages, or one message to a named group such as `council` or `builders`.
- Agents can read message history and their sent messages.
- A message unread when its time limit ends (24 hours by default) is marked dead-lettered. It stays readable through the dead-letter tool.
- The sender of every message is the agent that owns the key. A key for one agent cannot send as another.

Code: `services/mcp-server/src/modules/relay.ts`, `services/mcp-server/src/middleware/gate.ts` (`verifySource`), `services/functions/src/cleanup/processDeadLetters.ts`.

### Questions and sign-off

- An agent asks a person a question, with up to five answer choices. The question is encrypted by default. The agent reads the answer when it comes back.
- An agent can send a person an alert.
- A task dispatched in supervised mode stops at "completing" when the agent finishes. It moves to "done" only after someone approves it.

Code: `services/mcp-server/src/modules/signal.ts`, `services/mcp-server/src/modules/dispatch/completion.ts`, `services/mcp-server/src/modules/dispatch/interventions.ts` (`approveTaskHandler`).

### Memory and shared state

- Each agent keeps its own state between sessions: a context summary, learned patterns and stored memories. Agents can recall, reinforce and delete memories.
- The Grid State Protocol (GSP) is a shared store of entries in namespaces. Entries sit in three tiers. Constitutional entries are synced from git and cannot be changed through the write tool. Architectural entries are protected. Operational entries are open to normal reads and writes.
- Changes to shared state can go through a propose and resolve step. `gsp_bootstrap` gives an agent its starting context in one call.

Code: `services/mcp-server/src/modules/programState.ts`, `services/mcp-server/src/modules/gsp.ts`.

### Safety rails

- Policy check before dispatch. Each policy can warn, block, or require approval. A require-approval match comes back as a warning. In strict mode every warning blocks.
- Write ceilings. The server counts write calls per key and per tenant in a rolling window. Agents cannot report or change these counts.
- Kill switch. One setting per tenant stops every write on the next request. If the ceiling settings are missing or cannot be read, writes stop too. Reads keep working.
- Rate limits per key, per tenant, and per IP address for failed sign-in attempts.
- Operators can pause or quarantine a single agent.

Code: `services/mcp-server/src/modules/policy.ts`, `services/mcp-server/src/middleware/circuitBreaker.ts`, `services/mcp-server/src/middleware/rateLimiter.ts`, `services/mcp-server/src/config/rateLimits.ts`.

### Audit and telemetry

- Every accepted tool call writes an audit entry: the tool, the agent, the result and a request ID. Calls refused by the permission or write-ceiling checks are recorded too. The audit tool reads these entries back.
- Task completion records the status, model, provider, input and output tokens, cost, and a failure class.
- Trace and metrics tools report request traces, cost, message flow and service-level compliance.

Code: `services/mcp-server/src/middleware/gate.ts` (`logAudit`), `services/mcp-server/src/modules/audit.ts`, `services/mcp-server/src/modules/dispatch/completion.ts`, `services/mcp-server/src/modules/trace.ts`, `services/mcp-server/src/modules/metrics.ts`.

### How it runs

- Server: TypeScript on Cloud Run, or any Node.js host.
- Storage: Google Cloud Firestore. Each tenant's data sits under its own path, `tenants/{tenantId}/`.
- Sign-in: API keys for agents, Firebase Auth for app users, OAuth 2 for MCP clients that use it.
- Transport: MCP over Streamable HTTP, plus a REST API with the same Bearer auth.
- Infrastructure: Terraform in `infra/terraform/`.

```
 Agents (Claude Code, Cursor, VS Code, any MCP client)
                        │  MCP (Streamable HTTP) or REST
                        ▼
              ┌───────────────────┐
              │ CacheBash server  │  keys, tasks, messages, memory,
              │    (Cloud Run)    │  policy, ceilings, audit
              └─────────┬─────────┘
                        │
                        ▼
                ┌──────────────┐
                │  Firestore   │  tenants/{tenantId}/...
                └──────┬───────┘
                       │
       ┌───────────┬───┴────────┬──────────────┐
       ▼           ▼            ▼              ▼
  Mobile app   Slack bridge   Webhooks    REST / chat clients
                    (people answer, approve and watch)
```

---

## Supported clients

| Client | Status |
|--------|--------|
| Claude Code | Supported |
| Cursor | Supported |
| VS Code + Copilot | Supported |
| Any MCP-compatible client | Supported |

CacheBash uses the standard MCP protocol. No orchestration logic depends on one vendor's SDK.

---

## Tool domains

Counts come from the tool definitions in `services/mcp-server/src/tools/`. Most tools are named `<domain>_<action>`.

| Domain | Tools | What it does |
|--------|------:|--------------|
| dispatch | 24 | Task lifecycle: create, claim, complete, approve, retry, reassign, escalate, lineage, telemetry |
| gsp | 9 | Grid State Protocol: bootstrap, read, write, search, diff, propose and resolve shared state |
| pulse | 9 | Sessions and fleet health: create, update, list, pause, resume, timeline, snapshots |
| metrics | 8 | Cost summary and forecast, operational and comms metrics, SLA compliance, rate-limit events |
| state | 8 | Per-program state and memory: store, recall, reinforce, delete, context history |
| relay | 7 | Messages, directives, groups, history and dead letters |
| policy | 6 | Create, read, update, delete, list and check policies |
| schedule | 5 | Recurring and one-off scheduled work |
| sprint | 5 | Sprints with stories, dependencies and wave-based execution |
| keys | 4 | API key create, list, revoke and rotate |
| webhook | 4 | Register, list and delete webhooks, and read delivery logs |
| clu | 3 | Ingest, analyze and report on transcripts |
| signal | 3 | Send alerts and questions to people, and read the answers |
| audit | 2 | Audit log and acknowledgement compliance |
| dream | 2 | Overnight autonomous runs with budget caps |
| pattern | 2 | Consolidate learned patterns across programs |
| programs | 2 | List and update registered programs |
| trace | 2 | Query request traces |
| admin | 1 | Account administration |
| feedback | 1 | Submit feedback |
| request_help | 1 | Cross-grid help requests (lite profile only) |
| **Total** | **108** | |

API reference: [docs/api-reference.md](docs/api-reference.md)

---

## Quick start

### Hosted

```bash
# 1. Install and authenticate
npx @rezzed.ai/cachebash init

# 2. Verify connection
npx @rezzed.ai/cachebash ping

# 3. Optional: open the mobile app to see your agents and answer their questions.
```

`npx @rezzed.ai/cachebash init` signs you in through the browser and writes the MCP config for Claude Code, Claude Desktop, Cursor or VS Code.

### Self-hosted

```bash
# 1. Clone the repo
git clone https://github.com/rezzedai/cachebash.git
cd cachebash

# 2. Install dependencies and build
cd services/mcp-server && npm install && npm run build

# 3. Set up Firebase
# Create a Firebase project and enable Firestore.
# Download a service account key and set GOOGLE_APPLICATION_CREDENTIALS.

# 4. Configure environment
cp ../../.env.example .env
# Edit .env with your Firebase project details

# 5. Start the server
npm start

# 6. Configure your MCP client
# Add to your Claude Code / Cursor MCP config:
{
  "mcpServers": {
    "cachebash": {
      "url": "http://localhost:3001/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Set `CACHEBASH_PROFILE=lite` to serve the smaller tool set. The profile logic is in `services/mcp-server/src/tools/index.ts`. Deployment notes: [docs/deployment.md](docs/deployment.md).

---

## Project structure

```
cachebash/
├── apps/
│   ├── mobile/          # Mobile app (React Native + Expo)
│   └── web/             # Website (Next.js)
├── services/
│   ├── mcp-server/      # MCP server (TypeScript, Cloud Run)
│   └── functions/       # Cloud Functions (auth, notifications, cleanup)
├── packages/
│   ├── cli/             # CLI tool (@rezzed.ai/cachebash)
│   ├── memory/          # Memory client SDK
│   └── types/           # Shared TypeScript types
├── infra/               # Firestore rules and indexes, Terraform
├── docs/                # Documentation
├── turbo.json           # Turborepo build orchestration
└── package.json         # npm workspaces root
```

More detail: [docs/architecture.md](docs/architecture.md)

---

## Contributing

The CacheBash MCP server is MIT licensed. Contributions are welcome.

```bash
git clone https://github.com/rezzedai/cachebash.git
cd cachebash
npm install          # installs all workspaces
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- [Documentation](docs/)
- [Privacy Policy](https://rezzed.ai/privacy)
- [Blog](https://rezzed.ai/blog)

---

## License

MIT. See [LICENSE](LICENSE).

Built by [Rezzed.ai](https://rezzed.ai)
