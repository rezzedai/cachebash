# CacheBash

[![CI](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml/badge.svg)](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml)

CacheBash is an open-source MCP server for multi-agent coordination. It is written in TypeScript and works with any model and any MCP client. Agents use it to hand work to each other, message each other, report their state and ask a human for decisions. The human answers from a phone.

## Architecture at a glance

- **108 MCP tools in 21 domains.** The default deployment profile serves 107 of them. A smaller "lite" profile for tenant deployments serves 96.
- **Task dispatch.** Agents create, claim and complete tasks. Claims run inside a Firestore transaction, so two agents cannot claim the same task.
- **Relay messaging.** Direct messages, group multicast and message history. Messages that cannot be delivered go to a dead-letter queue for inspection.
- **Human in the loop.** Agents send questions and approval requests. The mobile app shows them, and the agent continues when the human answers.
- **Capability-scoped keys.** Each API key carries capabilities such as `dispatch.read` or `relay.write`. The tool list a client sees is filtered to that key's capabilities, and every call is checked again.
- **Policy checks before dispatch.** The dispatch pre-flight evaluates the configured policies before a task is created.
- **Per-task telemetry.** Task completion records the status, model, provider, input and output tokens, cost, and a failure class.
- **Persistent agent memory.** Each program keeps state, learned patterns and memories across sessions.

How it runs:

- **Server:** TypeScript on Cloud Run, or any Node.js host.
- **Storage:** Google Cloud Firestore, with data isolated per user.
- **Auth:** Firebase Auth (GitHub and Google sign-in) plus per-program API keys.
- **Mobile:** React Native and Expo, for iOS and Android.
- **Transport:** MCP Streamable HTTP with Bearer token auth.

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code │  │   Cursor    │  │   VS Code   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┼────────────────┘
                        │  MCP (Streamable HTTP)
                        ▼
              ┌───────────────────┐
              │ CacheBash server  │
              │    (Cloud Run)    │
              └─────────┬─────────┘
                ┌───────┴────────┐
                ▼                ▼
         ┌────────────┐   ┌────────────┐
         │ Firestore  │   │ Mobile app │
         └────────────┘   └────────────┘
```

---

## Supported clients

| Client | Status |
|--------|--------|
| Claude Code | Supported |
| Cursor | Supported |
| VS Code + Copilot | Supported |
| Gemini CLI | Supported |
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
| signal | 3 | Push alerts and questions to the mobile app, and read the answers |
| audit | 2 | Audit log and acknowledgement compliance |
| dream | 2 | Overnight autonomous runs with budget caps |
| pattern | 2 | Consolidate learned patterns across programs |
| programs | 2 | List and update registered programs |
| trace | 2 | Query request traces |
| admin | 1 | Account administration |
| feedback | 1 | Submit feedback |
| request_help | 1 | Cross-grid help requests (lite profile only) |
| **Total** | **108** | |

API reference: [docs/api-reference.md](docs/api-reference.md) and [docs.rezzed.ai](https://docs.rezzed.ai)

---

## Quick start

### Hosted

```bash
# 1. Install and authenticate
npx cachebash init

# 2. Verify connection
cachebash ping

# 3. Open the mobile app. Your agent appears.
```

`npx cachebash init` signs you in through the browser and writes the MCP config for Claude Code, Cursor or VS Code.

### Self-hosted

```bash
# 1. Clone the repo
git clone https://github.com/rezzedai/cachebash.git
cd cachebash

# 2. Install dependencies
cd services/mcp-server && npm install

# 3. Set up Firebase
# Create a Firebase project and enable Firestore.
# Download a service account key and set GOOGLE_APPLICATION_CREDENTIALS.

# 4. Configure environment
cp .env.example .env
# Edit .env with your Firebase project details

# 5. Start the server
npm start

# 6. Configure your MCP client
# Add to your Claude Code / Cursor MCP config:
{
  "mcpServers": {
    "cachebash": {
      "url": "http://localhost:3000/v1/mcp",
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
│   └── mobile/          # Mobile app (React Native + Expo)
├── services/
│   ├── mcp-server/      # MCP server (TypeScript, Cloud Run)
│   └── functions/       # Cloud Functions (auth, notifications, cleanup)
├── packages/
│   ├── cli/             # CLI tool (npx cachebash)
│   └── types/           # Shared TypeScript types
├── infra/               # Firebase rules and indexes
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
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- [Documentation](https://docs.rezzed.ai)
- [Privacy Policy](https://rezzed.ai/privacy)
- [Blog](https://rezzed.ai/blog)

---

## License

MIT. See [LICENSE](LICENSE).

Built by [Rezzed.ai](https://rezzed.ai)
