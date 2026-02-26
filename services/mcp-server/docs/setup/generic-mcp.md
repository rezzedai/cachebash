# CacheBash — Generic MCP Client Setup

For any client that implements the [Model Context Protocol](https://modelcontextprotocol.io/).

## Prerequisites

- An MCP-compatible client with HTTP transport support
- A CacheBash API key (generate one from the mobile app under Settings > API Keys)

## Connection Details

| Field | Value |
|-------|-------|
| **Transport** | Streamable HTTP |
| **Endpoint** | `https://api.cachebash.dev/v1/mcp` |
| **Auth Header** | `Authorization: Bearer CACHEBASH_API_KEY` |
| **Session Header** | `Mcp-Session-Id` (returned by server after initialize) |

## Configuration

Most MCP clients accept a JSON config in this format:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer CACHEBASH_API_KEY"
      }
    }
  }
}
```

Replace `CACHEBASH_API_KEY` with your actual key (starts with `cb_`).

## MCP Protocol Flow

1. **Initialize**: Client sends `initialize` request. Server responds with capabilities and a session ID via the `Mcp-Session-Id` response header.
2. **List Tools**: Client calls `tools/list` to discover available tools (18 tools across 6 modules).
3. **Call Tools**: Client sends `tools/call` requests with tool name and arguments.

## REST API Fallback

Every MCP tool has a REST equivalent. Use this if your client doesn't support MCP or if the session expires:

```bash
# List tasks
curl https://api.cachebash.dev/v1/tasks?target=YOUR_TARGET \
  -H "Authorization: Bearer CACHEBASH_API_KEY"

# Send a message
curl -X POST https://api.cachebash.dev/v1/messages \
  -H "Authorization: Bearer CACHEBASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"your-agent","target":"iso","message_type":"STATUS","message":"Hello"}'

# Complete a task
curl -X POST https://api.cachebash.dev/v1/tasks/TASK_ID/complete \
  -H "Authorization: Bearer CACHEBASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"completed_status":"SUCCESS"}'
```

## Available Tools

| Module | Tools |
|--------|-------|
| **Dispatch** | `get_tasks`, `create_task`, `claim_task`, `complete_task` |
| **Relay** | `send_message`, `get_messages`, `get_sent_messages`, `query_message_history` |
| **Pulse** | `create_session`, `update_session`, `list_sessions` |
| **Signal** | `ask_question`, `get_response`, `send_alert` |
| **Dream** | `dream_peek`, `dream_activate` |
| **Sprint** | `create_sprint`, `update_sprint_story`, `complete_sprint`, `get_sprint` |

## Verification

Call `list_sessions` with no arguments. A successful response confirms auth and connectivity.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Verify API key is correct and active. Must include `Bearer ` prefix. |
| `Session expired or invalid` | Re-initialize the MCP session. Sessions timeout after 60 minutes of inactivity. |
| Connection timeout | Cloud Run cold starts take ~2s. Retry once. |
| `CORS` errors (browser clients) | The server allows CORS from all origins. Check your client's request headers. |
| Tool not found | Call `tools/list` to see available tools. Tool names use underscores (e.g., `get_tasks`). |
