# CacheBash MCP — VS Code + GitHub Copilot Setup Guide

Connect CacheBash to VS Code using GitHub Copilot's MCP support.

## Prerequisites

- [VS Code](https://code.visualstudio.com) 1.100+ (MCP GA since 1.102)
- [GitHub Copilot extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) installed and active
- A CacheBash API key

## Config File Location

| Scope | Path | Key format |
|-------|------|------------|
| Workspace (recommended) | `.vscode/mcp.json` | `servers` (top-level) |
| User-level | VS Code `settings.json` | `mcp.servers` (nested) |

> VS Code uses `servers` — not `mcpServers`.

## Configuration

### Option A: Secure input prompt (recommended)

This prompts for your API key on first use — nothing stored in plaintext:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "cachebash-api-key",
      "description": "CacheBash MCP API Key",
      "password": true
    }
  ],
  "servers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${input:cachebash-api-key}"
      }
    }
  }
}
```

Save as `.vscode/mcp.json` in your workspace root.

### Option B: Environment variable

```json
{
  "servers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CACHEBASH_API_KEY}"
      }
    }
  }
}
```

Set `CACHEBASH_API_KEY` in your shell profile before launching VS Code.

### User-level config (settings.json)

To make CacheBash available across all workspaces, add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "cachebash": {
        "type": "http",
        "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
        "headers": {
          "Authorization": "Bearer ${env:CACHEBASH_API_KEY}"
        }
      }
    }
  }
}
```

## Verify Connection

1. Save `.vscode/mcp.json` in your workspace
2. Open Command Palette (Cmd/Ctrl+Shift+P) > **"MCP: List Servers"**
3. `cachebash` should appear in the server list
4. Open Copilot Chat and ask: "Use the list_sessions CacheBash tool"

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Server not listed | VS Code too old | Upgrade to VS Code 1.100+ (SSE header bug fixed in that release) |
| `401 Unauthorized` | Key not entered or env var missing | Re-enter when prompted (Option A) or check `CACHEBASH_API_KEY` is exported |
| Config ignored | Wrong key format | Use `servers` (not `mcpServers`) in `.vscode/mcp.json` |
| Tools not available in chat | Copilot extension disabled | Ensure GitHub Copilot is active and signed in |
| "Too many tools" warning | Exceeds 128 tool limit | Only applies if you have many MCP servers; CacheBash's ~30 tools are fine |

## Notes

- The `inputs` array with `"password": true` is VS Code's built-in secrets mechanism — your key is never stored in plaintext config files.
- VS Code tries Streamable HTTP first and falls back to SSE automatically.
- Session lifecycle is managed automatically — no manual session ID handling needed.
- Add `.vscode/mcp.json` to `.gitignore` if it contains hardcoded keys.
