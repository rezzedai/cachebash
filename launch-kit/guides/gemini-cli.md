# CacheBash MCP — Gemini CLI Setup Guide

Connect CacheBash to Google's Gemini CLI.

## Prerequisites

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed (`npm install -g @anthropic-ai/gemini-cli` or via source)
- A CacheBash API key

## Config File Location

| Scope | Path |
|-------|------|
| Global | `~/.gemini/settings.json` |
| Project-scoped | `<project-root>/.gemini/settings.json` |

## Configuration

### Option A: Hardcoded key

```json
{
  "mcpServers": {
    "cachebash": {
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "timeout": 30000,
      "trust": true
    }
  }
}
```

### Option B: Environment variable (recommended)

```json
{
  "mcpServers": {
    "cachebash": {
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer $CACHEBASH_API_KEY"
      },
      "timeout": 30000,
      "trust": true
    }
  }
}
```

Set `CACHEBASH_API_KEY` in your shell profile before launching Gemini CLI.

> Gemini CLI uses `$VAR_NAME` syntax for env var expansion — not `${env:VAR_NAME}`.

## Verify Connection

1. Save your config to `~/.gemini/settings.json`
2. Start a Gemini CLI session:
   ```bash
   gemini
   ```
3. Ask: "List the available CacheBash tools"
4. CacheBash tools should appear in the tool list

## Configuration Options

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | CacheBash MCP endpoint |
| `type` | No | `"http"` for Streamable HTTP (auto-detected if omitted) |
| `headers` | Yes | Auth headers |
| `timeout` | No | Request timeout in ms (default: 600,000ms / 10 min). 30s recommended for CacheBash. |
| `trust` | No | `true` auto-approves tool calls; `false` prompts for confirmation each time |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Env var not set or wrong syntax | Use `$VAR_NAME` (not `${env:VAR_NAME}`); verify with `echo $CACHEBASH_API_KEY` |
| Tools not loading | Config in wrong location | Check `~/.gemini/settings.json` exists and is valid JSON |
| Tool name conflicts | Multiple MCP servers with same tool names | Gemini CLI prefixes with `serverName__toolName` — no action needed |
| Schema validation warnings | Gemini strips `$schema`/`additionalProperties` | Normal behavior — CacheBash tools are compatible |
| Slow responses | Default 10-minute timeout | Set `"timeout": 30000` to fail fast on connection issues |

## Notes

- Setting `"trust": true` auto-approves all CacheBash tool calls without prompting. Set to `false` if you want per-call confirmation.
- Gemini CLI tries Streamable HTTP first, then falls back to SSE if `type` is omitted.
- The 30-second timeout is recommended — CacheBash operations typically complete in under 2 seconds.
- Never commit `settings.json` with hardcoded keys to version control.
