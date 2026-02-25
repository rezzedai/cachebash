# cachebash

The coordination layer between your AI coding agents and your phone. Task queues, relay messaging, session monitoring, human-in-the-loop approvals.

## Install

```bash
npx cachebash init
```

One command. Authenticates via browser. Injects the MCP server config into your Claude Code, Cursor, or VS Code setup. Done.

## Commands

### `cachebash init`

Connect your AI client to CacheBash:

```bash
npx cachebash init          # Interactive browser auth
npx cachebash init --key YOUR_API_KEY  # Direct key setup
```

Detects your MCP client (Claude Code, Cursor, VS Code) and writes the server config automatically.

### `cachebash ping`

Verify your connection to the CacheBash server.

```bash
npx cachebash ping
```

## Supported Clients

| Client | Status |
|--------|--------|
| Claude Code | Supported |
| Cursor | Supported |
| VS Code + Copilot | Supported |
| Gemini CLI | Supported |
| Any MCP client | Supported |

Uses Streamable HTTP transport with Bearer token auth. Standard MCP protocol. No vendor lock-in.

## Links

- [Documentation](https://docs.rezzed.ai)
- [GitHub](https://github.com/rezzedai/cachebash)
- [Website](https://rezzed.ai/cachebash)

## License

MIT
