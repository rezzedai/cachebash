# CacheBash — Claude Code CLI Setup

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- A CacheBash API key (generate one from the mobile app under Settings > API Keys)

## Configuration

1. In your project root (or home directory for global access), create or edit `.mcp.json`:

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

2. Replace `CACHEBASH_API_KEY` with your actual API key (starts with `cb_`).

3. Add `.mcp.json` to your `.gitignore` — it contains your API key:

```
echo '.mcp.json' >> .gitignore
```

## Verification

Start a Claude Code session and ask it to list sessions:

```
Use cachebash to list my active sessions.
```

Claude should call `list_sessions` and return results. If you see session data, the connection is live.

## REST Fallback

If the MCP session expires mid-conversation (BUG-004: sessions can die after 20-30 min), use the REST API directly:

```bash
curl -s https://api.cachebash.dev/v1/tasks?target=YOUR_PROGRAM \
  -H "Authorization: Bearer CACHEBASH_API_KEY"
```

All MCP tools have REST equivalents at `/v1/{tool_name}`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Verify your API key. Check that `.mcp.json` is in the working directory or a parent. |
| `Session expired or invalid` | Known issue (BUG-004). Start a new conversation or use the REST fallback above. |
| Tools not loading | Run `/mcp` in Claude Code to check MCP server status. Verify the `.mcp.json` path. |
| `ENOTFOUND` / DNS errors | Check internet connectivity. The server runs on GCP Cloud Run (`us-central1`). |
