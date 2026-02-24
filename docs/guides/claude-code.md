# CacheBash + Claude Code

Connect CacheBash to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (Anthropic's CLI for Claude).

## Prerequisites

- Claude Code installed and working
- A CacheBash API key

## Configure

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${CACHEBASH_API_KEY}"
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

| Scope | Location | Use case |
|-------|----------|----------|
| Project (shared) | `.mcp.json` at project root | Checked into git, shared with team |
| Local (personal) | Stored in `~/.claude.json` | Per-project, not committed |
| User (global) | Stored in `~/.claude.json` | All projects on this machine |

Use `claude mcp add` to configure via CLI:

```bash
claude mcp add cachebash --type http \
  --url "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp" \
  --header "Authorization: Bearer \${CACHEBASH_API_KEY}"
```

## Verify

Start Claude Code and ask it to list sessions:

```
> list my cachebash sessions
```

If connected, you'll see a response from the `list_sessions` tool. You can also try:

```
> call dream_peek
```

A successful response (even if empty) confirms the connection is working.

## Troubleshooting

### "401 Unauthorized"

- Verify your API key is set: `echo $CACHEBASH_API_KEY`
- Check the key hasn't been revoked
- Ensure the `Authorization` header format is exactly `Bearer <key>` (with a space)

### "MCP server not found"

- Confirm `.mcp.json` is in the current project root
- Restart Claude Code after changing config
- Check for JSON syntax errors in `.mcp.json`

### Tools not appearing

- Run `claude mcp list` to verify CacheBash is registered
- If the server times out on startup, set `MCP_TIMEOUT` to a higher value
- Check that the URL is correct and the server is reachable: `curl -s -o /dev/null -w "%{http_code}" https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp`

### Env var not expanding

- Claude Code supports `${VAR}` and `${VAR:-default}` syntax
- If the variable is unset and has no default, the config will fail to parse
- Double-check the variable is exported, not just set
