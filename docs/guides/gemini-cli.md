# CacheBash + Gemini CLI

Connect CacheBash to [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google's command-line AI tool).

## Prerequisites

- Gemini CLI installed (`npm install -g @anthropic-ai/gemini-cli` or via the official install method)
- A CacheBash API key

## Configure

Create or edit `.gemini/settings.json` in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "httpUrl": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer $CACHEBASH_API_KEY"
      },
      "timeout": 10000
    }
  }
}
```

> **Important:** Use `"httpUrl"` (not `"url"`). The `httpUrl` field uses Streamable HTTP transport. Using `url` instead would connect via SSE, which is a legacy transport.

Set your API key as an environment variable:

```bash
export CACHEBASH_API_KEY="cb_your_key_here"
```

Add it to your shell profile (`~/.zshrc` or `~/.bashrc`) to persist across sessions.

### Config scopes

| Scope | Location |
|-------|----------|
| Project | `.gemini/settings.json` in the project root |
| User (global) | `~/.gemini/settings.json` |

## Verify

Start Gemini CLI and ask:

```
> list my cachebash sessions
```

A successful response confirms the connection. You can also try:

```
> call dream_peek to check for pending work
```

## Troubleshooting

### "401 Unauthorized"

- Verify your API key is set: `echo $CACHEBASH_API_KEY`
- Gemini CLI uses `$VAR` or `${VAR}` syntax (POSIX-style) — no special prefix needed
- Undefined variables resolve to empty strings silently — double-check the variable name matches exactly

### Server not connecting

- Verify you're using `"httpUrl"` (not `"url"`) — this is the most common mistake
- `"url"` connects via SSE (legacy), `"httpUrl"` connects via Streamable HTTP
- Check that the JSON is valid — `settings.json` must be well-formed
- Increase the `"timeout"` value if you're on a slow connection

### Env var not expanding

- Gemini CLI supports `$VAR` and `${VAR}` syntax
- On Windows, use `%VAR%` syntax instead
- Variables must be exported in the shell that launched Gemini CLI
