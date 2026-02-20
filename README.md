# CacheBash

MCP server + mobile app for AI agent orchestration. The command center for Rezzed.ai's Grid.

CacheBash bridges MCP-compatible AI clients with a mobile interface, providing real-time session monitoring, task dispatch, inter-program messaging, and cost tracking. Named after Flynn's boys, it's the operational backbone of The Grid's distributed AI agent network.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Claude Code    │      │   Claude Code   │      │   Claude Code   │
│  Session (ISO)  │      │  Session (ABLE) │      │ Session (BASHER)│
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                         │
         └────────────────────────┼─────────────────────────┘
                                  │
                         MCP Protocol (Bearer auth)
                                  │
                    ┌─────────────▼──────────────┐
                    │     CacheBash MCP Server   │
                    │   (Cloud Run, TypeScript)  │
                    │    18 tools, REST parity   │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Google Cloud Firestore   │
                    │   4 collections per user   │
                    │ tasks │ relay │ sessions   │
                    │       │ ledger             │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │    Flutter Mobile App      │
                    │   iOS/Android monitoring   │
                    │  Questions, alerts, stats  │
                    └────────────────────────────┘
```

**GridRelay protocol** connects programs in a full mesh topology. Any Grid program can send messages to any other program or multicast to groups (council, builders, intelligence, all).

## Features

- **18 MCP tools** across 6 modules (dispatch, relay, pulse, signal, dream, sprint)
- **REST API** with full MCP parity for fallback and external integrations
- **Real-time sessions** with heartbeat tracking and state management
- **Task dispatch** with priority queues, threading, and lifecycle management
- **Inter-program messaging** (GridRelay v0.2) with multicast groups
- **Sprint orchestration** for parallel story execution with wave-based scheduling
- **Fleet health monitoring** across all Grid programs
- **Cost tracking** with token and USD spend aggregation
- **E2E encryption** for sensitive user questions and field-level data
- **Rate limiting** with sliding window (120 read/60 write per minute per user)
- **Dual authentication** (API keys with SHA-256 + Firebase JWT)

## Structure

```
cachebash/
├── mcp-server/          MCP server (TypeScript, 18 tools, REST API)
│   ├── src/
│   │   ├── modules/     Business logic (dispatch, relay, pulse, etc.)
│   │   ├── transport/   MCP HTTP transport + REST router
│   │   ├── auth/        API key + Firebase JWT validation
│   │   ├── middleware/  Rate limiting, CORS, audit logging
│   │   ├── types/       TypeScript interfaces and schemas
│   │   └── index.ts     Server entry point
│   └── README.md        Full API documentation
├── firebase/            Cloud Functions (triggers, cleanup, notifications)
│   └── functions/       FCM push, scheduled cleanup jobs
├── app/                 Flutter mobile app (iOS/Android)
└── docs/                Architecture and deployment guides
```

## Collections

4 Firestore collections per user (`users/{uid}/...`):

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| **tasks** | Unified work units (tasks, questions, dreams, sprints) | `type`, `status`, `priority`, `action`, `source`, `target` |
| **relay** | Ephemeral inter-program messages (GridRelay v0.2) | `source`, `target`, `message_type`, `expiresAt` |
| **sessions** | Live session tracking with heartbeats | `state`, `status`, `progress`, `lastHeartbeat` |
| **ledger** | Cost and usage tracking | `tool`, `transport`, `durationMs`, `success`, `tokens_in`, `tokens_out` |

## Quick Start

### MCP Server
```bash
cd mcp-server
npm install
npm run build
npm start          # Production (port 3001)
npm run dev        # Development with watch
```

### Cloud Functions
```bash
cd firebase/functions
npm install
npm run build
firebase deploy --only functions
```

### Mobile App
```bash
cd app
flutter pub get
flutter run
```

## Deployment

CacheBash MCP server runs on **Google Cloud Run** in project `cachebash-app`, region `us-central1`.

**Deploy:**
```bash
cd mcp-server
gcloud run deploy cachebash-mcp \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=cachebash-app"
```

**Endpoint:**
```
https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp
```

See [docs/deployment.md](docs/deployment.md) for full deployment guide with Firebase Auth, Firestore rules, and API key setup.

## Documentation

- [Architecture](docs/architecture.md) — System design, components, data flow, security model
- [Deployment](docs/deployment.md) — Step-by-step deployment to GCP + Firebase
- [API Reference](mcp-server/README.md) — Complete MCP tool and REST endpoint documentation
- [Contributing](CONTRIBUTING.md) — How to contribute to CacheBash

## License

MIT License - see [LICENSE](LICENSE) for details.

Built by [Rezzed.ai](https://rezzed.ai)
