# CacheBash + Cursor

## 1. Install

Get a CacheBash API key. Requires Cursor v0.5+.

## 2. Configure

Create `.cursor/mcp.json` in your project root:

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

Set the env var in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export CACHEBASH_API_KEY="cb_your_key_here"
```

You can also configure via **Cursor Settings > MCP**.

## 3. Verify

Open Cursor's AI chat and ask:

```
> list my cachebash sessions
```

Check **Cursor Settings > MCP** for a green connection indicator.

## Troubleshooting

- **401 Unauthorized** — Cursor uses `${env:VAR}` syntax (not `${VAR}`). Make sure you include the `env:` prefix.
- **Server not connecting** — Check JSON syntax in `.cursor/mcp.json`. Verify URL is reachable.
- **Env var not available** — If launched from Dock/Finder, shell vars may not load. Try launching from terminal: `open -a Cursor`.
