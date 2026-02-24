# CacheBash + ChatGPT Desktop

> **Status: Not yet supported.** ChatGPT requires OAuth 2.1 for MCP server auth. CacheBash currently uses Bearer token (API key) auth. OAuth 2.1 support is on the roadmap.

## Why it doesn't work yet

ChatGPT's MCP implementation exclusively requires OAuth 2.1 with:

- **Protected Resource Metadata** at `/.well-known/oauth-protected-resource`
- **Authorization Server Metadata** at `/.well-known/oauth-authorization-server`
- **Dynamic Client Registration** — each ChatGPT session gets a unique `client_id`
- **PKCE** (S256) is mandatory

Static Bearer tokens, API keys, and custom auth headers are not supported.

## What's needed

CacheBash would need to implement a full OAuth 2.1 authorization server to support ChatGPT. This includes:

1. Token issuance and verification endpoints
2. Dynamic client registration
3. PKCE challenge/response flow
4. Proper `aud` claim validation

## Additional requirements

- ChatGPT MCP is only available on **Business, Enterprise, and Edu plans** (not free or Plus)
- A workspace admin must enable developer mode
- MCP servers are registered through the ChatGPT web interface under **Settings > Apps & Connectors**, not via local config files

## Alternatives

While waiting for OAuth 2.1 support, you can use CacheBash with any of the supported clients:

- [Claude Code](claude-code.md) — primary client, production-tested
- [Cursor](cursor.md) — works out of the box
- [VS Code](vscode.md) — works with GitHub Copilot
- [Gemini CLI](gemini-cli.md) — works with env var expansion
