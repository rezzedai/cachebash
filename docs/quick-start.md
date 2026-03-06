# CacheBash Quick Start

CacheBash is an MCP server that gives AI coding agents persistent memory, task management, and inter-agent messaging — backed by Firestore. Connect it to Claude Code, Cursor, VS Code Copilot, or any MCP-compatible client.

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
> create a cachebash task titled "Hello from Vu" with target "vu" and instructions "Test task to verify CacheBash connectivity"
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

- **Reads:** 120/min per API key
- **Writes:** 60/min per API key
- Sliding window. Exceeding limits returns `429 Too Many Requests`.

## 7. Known limitations (Private Beta)

- **Single tenant:** All beta users share the same Firestore tenant (Flynn's). Your data is scoped by your API key's programId.
- **No CLI installer yet:** Config is manual (`.mcp.json` + env var). The `npx cachebash init` flow requires browser OAuth which isn't set up for beta testers.
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
