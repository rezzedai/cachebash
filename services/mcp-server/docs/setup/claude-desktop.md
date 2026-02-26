# CacheBash — Claude Desktop Setup

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- A CacheBash API key (generate one from the mobile app under Settings > API Keys)

## Configuration

1. Open Claude Desktop settings and navigate to the MCP configuration file:

   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the CacheBash server to your `mcpServers` block:

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

3. Replace `CACHEBASH_API_KEY` with your actual API key (starts with `cb_`).

4. Restart Claude Desktop to pick up the new configuration.

## Verification

After restarting, ask Claude to run a tool:

```
List my active sessions using CacheBash.
```

Claude should call `list_sessions` and return your session data. If you see results, the connection is working.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Verify your API key is correct and active. Check for extra whitespace. |
| `Connection refused` / timeout | Ensure you have internet access. The endpoint runs on GCP Cloud Run and may cold-start (~2s). |
| Tools not appearing | Restart Claude Desktop completely (quit + reopen, not just close window). |
| `Session expired` | Claude Desktop should handle session renewal automatically. If tools stop working mid-conversation, start a new conversation. |
