# @rezzed.ai/memory

Lightweight TypeScript client for storing and recalling learned patterns via CacheBash.

## Install

```bash
npm install @rezzed.ai/memory
```

## Quick Start

```typescript
import { CacheBashMemory } from "@rezzed.ai/memory";

const memory = new CacheBashMemory({
  apiKey: "your-api-key",
  programId: "your-program-id",
});

await memory.store({
  id: "pattern-001",
  domain: "workflow",
  pattern: "Always validate input before processing",
  confidence: 0.95,
  evidence: "Prevented 3 runtime errors in production",
});

const patterns = await memory.recall({ domain: "workflow" });
```

## API Reference

### Constructor

```typescript
new CacheBashMemory(config: CacheBashMemoryConfig)
```

| Parameter   | Type            | Required | Description                                      |
| ----------- | --------------- | -------- | ------------------------------------------------ |
| `apiKey`    | `string`        | Yes      | Your CacheBash API key                           |
| `programId` | `string`        | Yes      | Program ID for memory isolation                  |
| `transport` | `"rest" \| "mcp"` | No     | Transport mode (default: `"rest"`)               |
| `endpoint`  | `string`        | No       | Custom API endpoint URL                          |

### `store(input: StorePatternInput): Promise<void>`

Store or update a memory pattern. If a pattern with the same `id` exists, it will be replaced.

```typescript
await memory.store({
  id: "p-001",
  domain: "security",
  pattern: "Rate-limit all public endpoints",
  confidence: 0.92,
  evidence: "Blocked 3 brute-force attempts",
});
```

**StorePatternInput fields:**

| Field        | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `id`         | `string` | Unique pattern identifier              |
| `domain`     | `string` | Domain category (e.g. "security")      |
| `pattern`    | `string` | The learned pattern or rule            |
| `confidence` | `number` | Confidence score (0-1)                 |
| `evidence`   | `string` | Supporting evidence or context         |

### `recall(options?: RecallOptions): Promise<MemoryPattern[]>`

Recall memory patterns with optional filters. Excludes stale patterns by default.

```typescript
const all = await memory.recall();
const security = await memory.recall({ domain: "security" });
const search = await memory.recall({ search: "rate-limit" });
const withStale = await memory.recall({ includeStale: true });
```

**RecallOptions:**

| Field          | Type      | Description                         |
| -------------- | --------- | ----------------------------------- |
| `domain`       | `string`  | Filter by domain                    |
| `search`       | `string`  | Text search across pattern/evidence |
| `includeStale` | `boolean` | Include stale patterns (default: false) |

**Returns:** `MemoryPattern[]`

### `health(): Promise<MemoryHealth>`

Get memory health statistics.

```typescript
const health = await memory.health();
console.log(health.totalPatterns, health.activePatterns);
```

**Returns:**

| Field              | Type       | Description                          |
| ------------------ | ---------- | ------------------------------------ |
| `totalPatterns`    | `number`   | Total pattern count                  |
| `activePatterns`   | `number`   | Non-stale patterns                   |
| `promotedPatterns` | `number`   | Patterns promoted to permanent store |
| `stalePatterns`    | `number`   | Patterns marked as stale             |
| `domains`          | `string[]` | All domain names                     |
| `lastUpdatedAt`    | `string \| null` | Last update timestamp          |
| `lastUpdatedBy`    | `string \| null` | Last updating program          |
| `decay`            | `object`   | Decay configuration                  |

### `delete(patternId: string): Promise<void>`

Delete a memory pattern by ID.

```typescript
await memory.delete("p-001");
```

### `reinforce(patternId: string, options?: ReinforceOptions): Promise<void>`

Reinforce an existing pattern. Bumps `lastReinforced` timestamp and optionally updates confidence or evidence.

```typescript
await memory.reinforce("p-001", {
  confidence: 0.97,
  evidence: "Confirmed again in latest deploy",
});
```

**ReinforceOptions:**

| Field        | Type     | Description                   |
| ------------ | -------- | ----------------------------- |
| `confidence` | `number` | Updated confidence score      |
| `evidence`   | `string` | Updated evidence text         |

## Configuration

### Transport Modes

**REST (default):** Simple HTTP transport. Endpoint defaults to `https://api.cachebash.dev`.

```typescript
const memory = new CacheBashMemory({
  apiKey: "your-key",
  programId: "your-program",
  transport: "rest",
});
```

**MCP:** JSON-RPC over MCP transport. Endpoint defaults to `https://api.cachebash.dev/v1/mcp`.

```typescript
const memory = new CacheBashMemory({
  apiKey: "your-key",
  programId: "your-program",
  transport: "mcp",
});
```

### Custom Endpoint

```typescript
const memory = new CacheBashMemory({
  apiKey: "your-key",
  programId: "your-program",
  endpoint: "https://your-custom-endpoint.example.com",
});
```

## Error Handling

All methods throw standard `Error` objects on failure. Errors fall into three categories:

**HTTP errors** — The API returned a non-2xx status code. The error message includes the status code.

```typescript
try {
  await memory.store(pattern);
} catch (err) {
  // "HTTP 401: Unauthorized"
  // "HTTP 403: Forbidden"
  // "HTTP 404: Not Found"
  // "HTTP 500: Internal Server Error"
}
```

**API errors** — The API returned a 200 response with `success: false`.

```typescript
try {
  await memory.store(pattern);
} catch (err) {
  // "API error: <message from server>"
}
```

**Network errors** — The fetch call itself failed (DNS resolution, timeout, connection refused).

```typescript
try {
  await memory.store(pattern);
} catch (err) {
  // "fetch failed: network timeout"
  // "TypeError: Failed to fetch"
}
```

## Examples

See the [`examples/`](./examples/) directory for runnable scripts:

- [`basic-usage.ts`](./examples/basic-usage.ts) — Store, recall, reinforce, and delete patterns

Run an example:

```bash
CACHEBASH_API_KEY=your-key npx tsx packages/memory/examples/basic-usage.ts
```

## Running Tests

```bash
cd packages/memory
npm test
```

Or with watch mode:

```bash
npm run test:watch
```

## License

MIT
