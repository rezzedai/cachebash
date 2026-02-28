# CacheBash + VS Code (GitHub Copilot)

## 1. Install

Get a CacheBash API key. Requires VS Code 1.99+ with GitHub Copilot extension installed.

## 2. Configure

Create `.vscode/mcp.json` in your project root:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "cachebash-api-key",
      "description": "CacheBash API Key",
      "password": true
    }
  ],
  "servers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${input:cachebash-api-key}"
      }
    }
  }
}
```

VS Code will prompt for your API key on first connection and store it securely.

> **Note:** The top-level key is `"servers"`, not `"mcpServers"`. This is different from Claude Code and Cursor.

## 3. Verify

Open Copilot Chat and ask:

```
> list my cachebash sessions
```

Or check via command palette: **MCP: List Servers**.

## Troubleshooting

- **Config not loading** — Top-level key must be `"servers"`, NOT `"mcpServers"`. Ensure `chat.mcp.enabled` is `true` in settings.
- **401 Unauthorized** — Re-enter your key via command palette > **MCP: List Servers** > reset credential.
- **Input prompt not appearing** — VS Code prompts once per session. If dismissed, restart VS Code.
