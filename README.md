# CacheBash

[![CI](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml/badge.svg)](https://github.com/rezzedai/cachebash/actions/workflows/ci.yml)

**The coordination layer between your AI coding agents and your phone.**

Your AI agents can't reach you when you close the laptop. CacheBash connects them. Task queues, relay messaging, session monitoring, human-in-the-loop approvals. One MCP server. Every client that speaks the protocol.

---

## The Problem

You're running AI agents in your terminal. They write code, run tests, make decisions. But the moment they need your input, everything stops. You're at lunch. You closed the laptop. You're in a meeting.

Your agents can't coordinate with each other without you copying context between sessions. They can't ask you a question unless you're staring at the terminal. They can't run overnight because nobody's there to answer when they get stuck.

## The Fix

```bash
npx cachebash init
```

One command. Authenticates via browser. Injects the MCP config into your Claude Code, Cursor, or VS Code setup. Done. Under 60 seconds.

Open the mobile app. Your agents appear. Send tasks, answer questions, monitor sessions — all from your phone.

---

## What It Does

**Task Queues** — Dispatch work from your phone. Your agent picks it up in the terminal. Create tasks while you're away from your desk. Agents execute when they check in.

**Relay Messaging** — Your agents talk to each other through CacheBash. Agent A creates a task. Agent B claims it. Direct messaging, multicast to groups, delivery confirmation. No copy-paste. No you in the middle.

**Session Monitoring** — See which agents are running, what they're working on, how far along they are. Real-time updates. Push notifications when something needs your attention.

**Human-in-the-Loop** — Agent needs a decision? Your phone buzzes. Read the context. Tap to respond. The agent continues. You never opened a laptop.

**Dream Mode** — Dispatch work before bed. Set budget caps. Agents execute autonomously overnight. Wake up to pull requests, not a blank terminal.

**Sprint Orchestration** — Group related tasks into sprints with wave-based execution. Define dependencies between stories. Track progress across parallel workstreams.

---

## Supported Clients

| Client | Status |
|--------|--------|
| Claude Code | Supported |
| Cursor | Supported |
| VS Code + Copilot | Supported |
| Gemini CLI | Supported |
| Any MCP-compatible client | Supported |

CacheBash uses Streamable HTTP transport with Bearer token auth. Standard MCP protocol. No vendor lock-in.

---

## 34 MCP Tools

Organized into 8 modules:

| Module | What It Does | Tools |
|--------|-------------|-------|
| **Dispatch** | Task lifecycle — create, claim, complete, query | `create_task`, `get_tasks`, `claim_task`, `complete_task` |
| **Relay** | Inter-agent messaging with delivery confirmation | `send_message`, `get_messages`, `get_sent_messages`, `query_message_history` |
| **Pulse** | Session health — create, update, list, heartbeat | `create_session`, `update_session`, `list_sessions` |
| **Sprint** | Parallel work orchestration with dependencies | `create_sprint`, `update_sprint_story`, `add_story_to_sprint`, `complete_sprint`, `get_sprint` |
| **Signal** | Push notifications and mobile questions | `ask_question`, `get_response`, `send_alert` |
| **Dream** | Autonomous overnight execution with budget caps | `dream_peek`, `dream_activate` |
| **State** | Persistent per-program memory across sessions | `get_program_state`, `update_program_state` |
| **Keys** | API key lifecycle — create, revoke, list | `create_key`, `revoke_key`, `list_keys` |
| **Observability** | Audit logs, metrics, cost tracking, traces | `get_audit`, `get_comms_metrics`, `get_cost_summary`, `get_operational_metrics`, `query_traces` |

Full reference: [docs.rezzed.ai](https://docs.rezzed.ai)

---

## Quick Start

### Hosted (Recommended)

```bash
# 1. Install and authenticate
npx cachebash init

# 2. Verify connection
cachebash ping

# 3. Open the mobile app — your agent appears
```

The hosted version runs on Google Cloud. Free tier: 3 programs, 500 tasks/month, 1 concurrent session.

### Self-Hosted

```bash
# 1. Clone the repo
git clone https://github.com/rezzedai/cachebash.git
cd cachebash

# 2. Install dependencies
cd services/mcp-server && npm install

# 3. Set up Firebase
# Create a Firebase project, enable Firestore
# Download service account key → set GOOGLE_APPLICATION_CREDENTIALS

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

---

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code  │  │   Cursor    │  │   VS Code   │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────────┬────┴────────────────┘
                    │  MCP Protocol
                    ▼
          ┌─────────────────┐
          │  CacheBash MCP  │
          │     Server      │
          │  (Cloud Run)    │
          └────────┬────────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
   ┌────────────┐   ┌────────────┐
   │  Firestore  │   │ Mobile App │
   │  (Storage)  │   │  (iOS/And) │
   └─────────────┘   └────────────┘
```

- **MCP Server:** TypeScript, runs on Cloud Run (or any Node.js host)
- **Storage:** Google Cloud Firestore (multi-tenant, per-user isolation)
- **Auth:** Firebase Auth (GitHub + Google OAuth) + per-program API keys
- **Mobile:** React Native + Expo (iOS + Android)
- **Transport:** Streamable HTTP with Bearer token auth

---

## Project Structure

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

---

## Pricing

| | Free | Pro | Team |
|---|---|---|---|
| Price | $0 | $29/mo | $99/mo |
| Programs | 3 | Unlimited | Unlimited |
| Tasks/month | 500 | Unlimited | Unlimited |
| Concurrent sessions | 1 | 5 | 10 |

You bring the models. CacheBash runs the orchestra. We never touch your LLM API keys.

Free tier is real. 500 tasks/month runs a serious workflow. Upgrade when you outgrow it.

---

## Contributing

CacheBash MCP server is MIT licensed. Contributions welcome.

```bash
# Set up development environment
git clone https://github.com/rezzedai/cachebash.git
cd cachebash
npm install          # installs all workspaces
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- [Documentation](https://docs.rezzed.ai)
- [Mobile App (iOS)](https://apps.apple.com/app/cachebash) *(coming soon)*
- [Mobile App (Android)](https://play.google.com/store/apps/details?id=ai.rezzed.cachebash) *(coming soon)*
- [Privacy Policy](https://rezzed.ai/privacy)
- [Blog](https://rezzed.ai/blog)

---

## License

MIT — see [LICENSE](LICENSE)

Built by [Rezzed.ai](https://rezzed.ai)
