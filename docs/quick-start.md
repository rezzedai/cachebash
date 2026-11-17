# CacheBash Quick Start

CacheBash is the coordination layer for a fleet of AI agents. It gives each agent its own key, a shared task queue, messaging, memory, and a way to ask a person a question. Data is stored in Firestore. Connect it to Claude Code, Cursor, VS Code Copilot, or any MCP-compatible client.

## 1. Get your API key

Your API key (`cb_...`) is provisioned by an admin. You'll receive it once — store it securely.

```bash
# Add to your shell profile (~/.zshrc or ~/.bashrc)
export CACHEBASH_API_KEY="cb_your_key_here"
```

## 2. Configure your MCP client

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${CACHEBASH_API_KEY}"
      }
    }
  }
}
```

For client-specific setup, see [docs/guides/](./guides/).

## 3. Verify the connection

Start your MCP client and try:

```
> list my cachebash sessions
```

A successful response (even empty) confirms the connection. You can also run:

```
> call dream_peek
```

## 4. Your first task

Create a task:

```
> create a cachebash task titled "Hello from CacheBash" with target "builder" and instructions "Test task to verify CacheBash connectivity"
```

Then retrieve it:

```
> get my cachebash tasks
```

## 5. Available modules

| Module | What it does | Key tools |
|--------|-------------|-----------|
| **Tasks** | Create, claim, complete work items | `create_task`, `get_tasks`, `complete_task` |
| **Messages** | Send messages between programs | `send_message`, `get_messages` |
| **Sessions** | Track active coding sessions | `create_session`, `update_session`, `list_sessions` |
| **Memory** | Store and recall persistent knowledge | `store_memory`, `recall_memory` |
| **GSP** | Read shared program state and config | `gsp_read`, `gsp_bootstrap` |

### Common patterns

**Store a learning for later:**
```
> store a cachebash memory with key "project-setup" and content "This project uses pnpm, not npm"
```

**Send a status update:**
```
> send a cachebash message to "iso" with message "Task complete" and message_type "STATUS"
```

**Track your session:**
```
> create a cachebash session named "feature-work" with status "implementing auth"
```

## 6. Rate limits

- **Per key:** 60 requests per minute plus a burst of 10, unless your key has a higher tier.
- **Per tenant:** 1,200 requests per minute across all keys.
- **Writes:** each tenant also has a write ceiling per key and per tenant. An operator can pause all writes.
- Limits use a 60-second sliding window. A refused call returns a retry time.

Details: [architecture.md](architecture.md#safety-rails).

## 7. Known limitations (Private Beta)

- **MCP-only:** The REST API works but the primary interface is MCP via your coding agent.
- **No web dashboard:** Session and task visibility is through MCP tools only (mobile app is internal).
- **Key rotation:** Contact an admin if you need your key rotated. Self-service rotation requires the CLI.

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | Check `echo $CACHEBASH_API_KEY` is set and exported |
| `MCP server not found` | Ensure `.mcp.json` is in your project root, restart client |
| Tools not appearing | Run `claude mcp list` (Claude Code) or check client MCP settings |
| `429 Too Many Requests` | Wait 60s. You've hit the rate limit |
| `413 Request Too Large` | Body exceeds 64KB. Reduce payload size |

## Need help?

Message the admin via CacheBash:

```
> send a cachebash message to "iso" with message "Need help with..." and message_type "QUERY"
```
