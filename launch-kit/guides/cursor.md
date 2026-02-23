# CacheBash MCP — Cursor Setup Guide

Connect CacheBash to Cursor using Streamable HTTP transport.

## Prerequisites

- [Cursor](https://cursor.com) installed (v0.40+)
- A CacheBash API key
- (Fallback only) Node.js 18+ and `npx` available

## Config File Location

| Scope | Path |
|-------|------|
| Global | `~/.cursor/mcp.json` |
| Project-scoped | `<project-root>/.cursor/mcp.json` |

## Configuration

### Option A: Direct HTTP (recommended)

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "streamable-http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Option B: Environment variable for the key

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "streamable-http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CACHEBASH_API_KEY}"
      }
    }
  }
}
```

Set `CACHEBASH_API_KEY` in your shell profile before launching Cursor.

### Option C: mcp-remote bridge (fallback)

Some Cursor versions have a bug where `cursor-agent` silently drops auth headers. If you get persistent `401` errors with Option A, use the `mcp-remote` npm bridge:

```json
{
  "mcpServers": {
    "cachebash": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
        "--header",
        "Authorization: Bearer ${CACHEBASH_API_KEY}"
      ],
      "env": {
        "CACHEBASH_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

## Verify Connection

1. Save your config file
2. **Fully restart Cursor** (Cmd/Ctrl+Shift+P > "Reload Window" is not enough)
3. Open **Cursor Settings > MCP** — `cachebash` should show as connected
4. In chat, ask: "Use the list_sessions CacheBash tool"

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Auth headers dropped by `cursor-agent` | Switch to Option C (`mcp-remote` bridge) |
| Server not showing in settings | Config not loaded | Full restart (not just reload window) |
| JSON parse error | Trailing comma or syntax error | Validate JSON — Cursor's parser is strict, no trailing commas |
| Tools not appearing in chat | MCP Resources requested | CacheBash exposes Tools only, not Resources |
| `env:` variable not expanding | Used `env` with URL-based server | `${env:VAR}` works in `headers`; `env` object only works with `command`-based servers |

## Notes

- CacheBash exposes ~30 tools, well within Cursor's performance limits (issues start at 70+).
- After any config change, always do a full Cursor restart.
- Never commit `mcp.json` with hardcoded keys to version control.
