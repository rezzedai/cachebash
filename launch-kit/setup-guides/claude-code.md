# CacheBash + Claude Code

## 1. Install

Get a CacheBash API key from the mobile app or your admin.

## 2. Configure

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${CACHEBASH_API_KEY}"
      }
    }
  }
}
```

Set the env var in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export CACHEBASH_API_KEY="cb_your_key_here"
```

Or use the CLI:

```bash
claude mcp add cachebash --type http \
  --url "https://api.cachebash.dev/v1/mcp" \
  --header "Authorization: Bearer \${CACHEBASH_API_KEY}"
```

## 3. Verify

Start Claude Code and run:

```
> list my cachebash sessions
```

A response from `list_sessions` confirms the connection.

## Troubleshooting

- **401 Unauthorized** — Check `echo $CACHEBASH_API_KEY` is set and the key isn't revoked.
- **MCP server not found** — Ensure `.mcp.json` is at project root. Restart Claude Code after config changes.
- **Env var not expanding** — Variable must be `export`ed, not just set. Claude Code uses `${VAR}` syntax.
