# CacheBash v2

MCP server + mobile app for the Grid. Bridges Claude Code sessions with a Flutter mobile interface for real-time monitoring, question answering, and task management.

## Structure

```
cachebash/
  mcp-server/     MCP server (TypeScript, 18 tools, REST API)
  firebase/       Cloud Functions (triggers, cleanup, notifications)
  app/            Flutter mobile app (iOS/Android)
```

## Collections

4 Firestore collections per user:

- **tasks** — Unified work units (tasks, questions, dreams, sprints)
- **relay** — Ephemeral inter-program messages
- **sessions** — Live session tracking with heartbeats
- **ledger** — Cost and usage tracking

## Quick Start

```bash
# MCP Server
cd mcp-server && npm install && npm run dev

# Cloud Functions
cd firebase/functions && npm install && npm run build

# Mobile App
cd app && flutter pub get && flutter run
```

See [mcp-server/README.md](mcp-server/README.md) for full API documentation.
