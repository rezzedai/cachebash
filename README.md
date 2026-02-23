# CacheBash

An MCP server that lets your AI coding sessions communicate with each other. Create tasks, send messages, and coordinate work across multiple agents through a shared backend.

## The Problem

AI coding assistants run in isolated sessions. When you use multiple agents — one reviewing code, another writing tests, a third handling deployment — they can't share context or coordinate. CacheBash adds a communication layer between them using the Model Context Protocol (MCP).

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Claude Code │  │    Cursor    │  │   VS Code    │  │  Gemini CLI  │
│  (Agent A)   │  │  (Agent B)   │  │  (Agent C)   │  │  (Agent D)   │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                 │
       └─────────────────┼─────────────────┼─────────────────┘
                         │
                MCP Protocol (Bearer auth)
                         │
           ┌─────────────▼──────────────┐
           │    CacheBash MCP Server    │
           │   Cloud Run · TypeScript   │
           │     34 tools · REST API    │
           └─────────────┬──────────────┘
                         │
           ┌─────────────▼──────────────┐
           │   Google Cloud Firestore   │
           │  tasks · relay · sessions  │
           │  programState · telemetry  │
           └─────────────┬──────────────┘
                         │
           ┌─────────────▼──────────────┐
           │       Mobile App           │
           │      iOS / Android         │
           │  Monitoring · Approvals    │
           └────────────────────────────┘
```

## Supported Clients

CacheBash uses Streamable HTTP transport with Bearer token auth. Works with any MCP client that supports both:

| Client | Status |
|--------|--------|
| Claude Code | Production driver. Used daily. |
| Cursor | Works out of the box. |
| VS Code (GitHub Copilot) | Works out of the box. |
| Gemini CLI | Works. Supports env var expansion for API keys. |
| ChatGPT Desktop | Not yet supported — requires OAuth 2.1. |

## Quick Start

### 1. Clone and Build

```bash
git clone https://github.com/your-org/cachebash.git
cd cachebash/mcp-server
npm install
npm run build
```

### 2. Set Up Firestore

CacheBash uses Google Cloud Firestore for storage. You can use the Firebase emulator for local development:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Start emulator
cd ../firebase
firebase emulators:start --only firestore

# In another terminal, point server at emulator
export FIRESTORE_EMULATOR_HOST="localhost:8080"
```

### 3. Start the Server

```bash
cd mcp-server
npm run dev    # Development with watch (port 3001)
```

### 4. Configure Your MCP Client

Add to your client's MCP configuration:

```json
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

Your AI session now has 34 coordination tools available.

## MCP Tools (34)

| Module | Tools | Purpose |
|--------|-------|---------|
| Dispatch | `create_task`, `get_tasks`, `claim_task`, `complete_task` | Task lifecycle — priority queues, claim-based ownership |
| Relay | `send_message`, `get_messages`, `get_sent_messages`, `query_message_history`, `get_dead_letters`, `list_groups` | Inter-agent messaging — direct, multicast, threaded |
| Pulse | `create_session`, `update_session`, `list_sessions`, `get_fleet_health` | Session health, heartbeat, fleet-wide monitoring |
| Sprint | `create_sprint`, `update_sprint_story`, `add_story_to_sprint`, `complete_sprint`, `get_sprint` | Parallel work — stories, waves, dependencies |
| Signal | `ask_question`, `get_response`, `send_alert` | Push questions and alerts to mobile app |
| Dream | `dream_peek`, `dream_activate` | Autonomous scheduling with budget caps |
| Program State | `get_program_state`, `update_program_state` | Persistent agent memory across sessions |
| Keys | `create_key`, `list_keys`, `revoke_key` | Per-agent API key management |
| Observability | `get_audit`, `get_cost_summary`, `get_comms_metrics`, `get_operational_metrics`, `query_traces` | Audit log, cost tracking, metrics, execution traces |

## Features

- **Task dispatch** with priority queues, lifecycle tracking, and claim-based ownership
- **Message relay** with direct messaging, multicast groups, thread support, and dead letter queue
- **Session tracking** with heartbeat monitoring, fleet health dashboard, and state management
- **Sprint orchestration** for parallel work with wave-based scheduling and retry policies
- **Program state** — persistent operational memory across sessions (context, learned patterns, handoff notes)
- **Dream mode** — autonomous overnight scheduling with budget caps
- **Observability** — audit log, cost/token tracking, comms metrics, operational metrics, execution traces
- **REST API** with full MCP tool parity for non-MCP integrations
- **E2E encryption** for sensitive fields (user questions, alerts)
- **Rate limiting** with sliding window (120 read / 60 write per minute per user)
- **Dual auth** via API keys (SHA-256 hashed) and Firebase JWT
- **Cost tracking** with token and USD spend aggregation per session, per agent
- **Mobile app** (React Native + Expo) for monitoring, approvals, and alerts

## Project Structure

```
cachebash/
├── mcp-server/       MCP server (TypeScript, Cloud Run)
│   ├── src/
│   │   ├── modules/     11 modules (dispatch, relay, pulse, sprint, signal, dream, keys, audit, programState, metrics, trace)
│   │   ├── transport/   MCP HTTP transport + REST router
│   │   ├── auth/        API key + Firebase JWT validation
│   │   ├── middleware/  Rate limiting, gate (source verification), capabilities
│   │   ├── lifecycle/   State machine engine, wake daemon
│   │   └── types/       TypeScript interfaces
│   └── package.json
├── firebase/         Cloud Functions (push notifications, cleanup)
├── mobile/           React Native + Expo mobile app
├── app/              Flutter mobile app (legacy)
└── docs/             Architecture and deployment guides
```

## Deployment

Deploy to Google Cloud Run:

```bash
cd mcp-server
gcloud run deploy cachebash-mcp \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

See [docs/deployment.md](docs/deployment.md) for the full guide including Firestore setup, Firebase Auth, and API key configuration.

## Documentation

- [Architecture](docs/architecture.md) — System design, data model, security
- [Deployment](docs/deployment.md) — Self-hosting on GCP + Firebase
- [API Reference](mcp-server/README.md) — Tool and REST endpoint docs
- [Contributing](CONTRIBUTING.md) — Development setup and PR process

## License

MIT — see [LICENSE](LICENSE).
