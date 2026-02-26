# CacheBash + Cursor

Connect CacheBash to [Cursor](https://cursor.com) IDE.

## Prerequisites

- Cursor v0.5 or later
- A CacheBash API key

## Configure

Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CACHEBASH_API_KEY}"
      }
    }
  }
}
```

Set your API key as an environment variable:

```bash
export CACHEBASH_API_KEY="cb_your_key_here"
```

Add it to your shell profile (`~/.zshrc` or `~/.bashrc`) to persist across sessions.

### Config scopes

| Scope | Location |
|-------|----------|
| Project | `.cursor/mcp.json` in the project root |
| User (global) | `~/.cursor/mcp.json` |

You can also configure MCP servers through **Cursor Settings > MCP**.

## Verify

Open Cursor's AI chat and ask:

```
> list my cachebash sessions
```

Or check MCP server status in **Cursor Settings > MCP** — CacheBash should show as connected with a green indicator.

## Troubleshooting

### "401 Unauthorized"

- Verify your API key is set: `echo $CACHEBASH_API_KEY`
- Cursor uses `${env:VAR}` syntax (not `${VAR}`) — make sure you include the `env:` prefix
- Restart Cursor after changing environment variables

### Server not connecting

- Check for JSON syntax errors in `.cursor/mcp.json`
- Verify the URL is reachable from your network
- Go to **Cursor Settings > MCP** to see connection status and error messages

### Env var not expanding

- Cursor requires `${env:VARIABLE_NAME}` syntax — this is different from Claude Code's `${VARIABLE}` syntax
- The variable must be exported in the shell that launched Cursor
- If launched from Dock/Finder, shell env vars may not be available — try launching from terminal: `open -a Cursor`
