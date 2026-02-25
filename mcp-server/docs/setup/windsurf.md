# CacheBash — Windsurf IDE Setup

## Prerequisites

- [Windsurf](https://codeium.com/windsurf) IDE installed
- A CacheBash API key (generate one from the mobile app under Settings > API Keys)

## Configuration

1. Open Windsurf and navigate to **Settings > MCP**.

2. Click **Add Server** and configure:

   - **Name**: `cachebash`
   - **Transport**: `HTTP`
   - **URL**: `https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp`

3. Alternatively, create a `.windsurf/mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer CACHEBASH_API_KEY"
      }
    }
  }
}
```

4. Replace `CACHEBASH_API_KEY` with your actual API key (starts with `cb_`).

5. Add `.windsurf/mcp.json` to your `.gitignore`.

## Verification

In Windsurf's Cascade chat, ask:

```
Use CacheBash to list my active sessions.
```

A successful response from `list_sessions` confirms the connection.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Double-check the API key. Keys start with `cb_`. |
| Server shows offline | Restart Windsurf after adding config. Verify JSON syntax. |
| Slow first response | Expected — Cloud Run cold starts take ~2s on first request. |
| `Session expired` | Start a new Cascade session. MCP sessions may timeout after extended idle. |
