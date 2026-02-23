# CacheBash MCP — Claude Code Setup Guide

Connect CacheBash to Claude Code in under 2 minutes.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A CacheBash API key (get one from your admin or generate via the `create_key` tool)

## Config File Location

| Scope | Path |
|-------|------|
| Global (all projects) | `~/.mcp.json` |
| Project-scoped | `<project-root>/.mcp.json` |

## Configuration

Add the following to your `.mcp.json`:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Replace `YOUR_API_KEY` with your actual CacheBash API key.

## Verify Connection

1. Start a new Claude Code session (or restart your current one)
2. Ask Claude to run any CacheBash tool:
   ```
   Use the list_sessions tool to check active sessions
   ```
3. If tools load correctly, you'll see CacheBash tools in Claude's available tool list

All 30+ CacheBash tools should be available immediately — no additional setup required.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Tools not appearing | Stale session | Restart Claude Code (`/exit` then relaunch) |
| `401 Unauthorized` | Invalid or expired API key | Verify your key with `curl -H "Authorization: Bearer YOUR_KEY" https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp` |
| Connection timeout | Network issue or endpoint down | Check endpoint status; ensure no firewall/VPN blocking HTTPS |
| Project config not loading | Wrong file location | Ensure `.mcp.json` is in the project root, not a subdirectory |

## Notes

- Claude Code is CacheBash's reference client — this is the most battle-tested integration.
- Session management (MCP session IDs, reconnection) is handled automatically.
- Global config (`~/.mcp.json`) applies to all projects. Project-scoped config overrides global for that project.
- Never commit `.mcp.json` to version control — it contains your API key. Add it to `.gitignore`.
