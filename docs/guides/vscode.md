# CacheBash + VS Code

Connect CacheBash to [VS Code](https://code.visualstudio.com) with GitHub Copilot Chat MCP support.

## Prerequisites

- VS Code 1.99 or later
- GitHub Copilot extension installed
- A CacheBash API key

## Configure

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
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${input:cachebash-api-key}"
      }
    }
  }
}
```

VS Code will prompt you for the API key on first connection and store it securely.

### Alternative: hardcoded key

If you prefer not to use the interactive prompt (e.g., for automation):

```json
{
  "servers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer cb_your_key_here"
      }
    }
  }
}
```

> **Note:** The top-level key is `"servers"`, not `"mcpServers"`. This is different from Claude Code and Cursor.

### User-level config

To add CacheBash globally, open the command palette (`Cmd+Shift+P`) and run **MCP: Open User Configuration**, then add the same server block.

## Verify

Open Copilot Chat and ask:

```
> list my cachebash sessions
```

You can also check MCP status via the command palette: **MCP: List Servers**.

## Troubleshooting

### "401 Unauthorized"

- Re-enter your API key — open command palette, run **MCP: List Servers**, find CacheBash, and reset the credential
- If using a hardcoded key, verify it hasn't been revoked

### Config not loading

- The top-level key must be `"servers"`, NOT `"mcpServers"` — this is the most common mistake when porting from other clients
- Ensure GitHub Copilot extension is installed and `chat.mcp.enabled` is `true` in settings
- Requires VS Code 1.99+ — check your version with **Help > About**

### Input prompt not appearing

- VS Code prompts once per session — if you dismissed it, restart VS Code
- Check that the `"inputs"` array `id` matches the `${input:id}` reference exactly
