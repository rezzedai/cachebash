# CacheBash — Cursor IDE Setup

## Prerequisites

- [Cursor](https://cursor.sh) IDE installed
- A CacheBash API key (generate one from the mobile app under Settings > API Keys)

## Configuration

1. Open Cursor Settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux).

2. Navigate to **Features > MCP Servers**.

3. Click **Add new MCP server** and enter:

   - **Name**: `cachebash`
   - **Type**: `http`
   - **URL**: `https://api.cachebash.dev/v1/mcp`

4. Alternatively, create a `.cursor/mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer CACHEBASH_API_KEY"
      }
    }
  }
}
```

5. Replace `CACHEBASH_API_KEY` with your actual API key (starts with `cb_`).

6. Add `.cursor/mcp.json` to your `.gitignore`.

## Verification

Open Cursor's AI chat and ask:

```
Use CacheBash to list my active sessions.
```

If `list_sessions` returns data, the connection is working.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Verify your API key is correct and hasn't been revoked. |
| Server not appearing | Restart Cursor after adding the config. Check that the file is valid JSON. |
| Tools timeout | Cloud Run cold starts can take ~2s. Retry the request. |
| `Session expired` | Start a new chat session. MCP sessions may expire after extended idle time. |
