# CacheBash + Gemini CLI

## 1. Install

Get a CacheBash API key. Install [Gemini CLI](https://github.com/google-gemini/gemini-cli).

## 2. Configure

Create `.gemini/settings.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "httpUrl": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer $CACHEBASH_API_KEY"
      },
      "timeout": 10000
    }
  }
}
```

> **Important:** Use `"httpUrl"` (not `"url"`). The `httpUrl` field uses Streamable HTTP transport. `"url"` would use legacy SSE transport.

Set the env var in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export CACHEBASH_API_KEY="cb_your_key_here"
```

## 3. Verify

Start Gemini CLI and ask:

```
> list my cachebash sessions
```

A successful response confirms the connection.

## Troubleshooting

- **Server not connecting** — Verify you're using `"httpUrl"` (not `"url"`). This is the most common mistake.
- **401 Unauthorized** — Check `echo $CACHEBASH_API_KEY`. Undefined vars resolve to empty strings silently.
- **Env var syntax** — Gemini CLI uses `$VAR` or `${VAR}` (POSIX-style). On Windows, use `%VAR%`.
