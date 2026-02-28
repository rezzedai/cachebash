# CacheBash + ChatGPT Desktop

> **Status: Not yet supported.** Flagged as untested — ChatGPT requires OAuth 2.1 which CacheBash does not yet implement.

## Why it doesn't work yet

ChatGPT's MCP implementation exclusively requires OAuth 2.1 with:

- Protected Resource Metadata at `/.well-known/oauth-protected-resource`
- Authorization Server Metadata at `/.well-known/oauth-authorization-server`
- Dynamic Client Registration per session
- PKCE (S256) mandatory

Static Bearer tokens and API keys are not supported by ChatGPT.

## Additional requirements

- ChatGPT MCP is only available on **Business, Enterprise, and Edu plans**
- A workspace admin must enable developer mode
- MCP servers are registered through the ChatGPT web interface (**Settings > Apps & Connectors**), not via local config files

## Alternatives

Use CacheBash with any supported client:

- [Claude Code](claude-code.md)
- [Cursor](cursor.md)
- [VS Code + Copilot](vscode-copilot.md)
- [Gemini CLI](gemini-cli.md)
