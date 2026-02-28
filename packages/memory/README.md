# @rezzed.ai/memory

**CacheBash Memory SDK** — Lightweight TypeScript client for storing and recalling learned patterns via CacheBash.

## Installation

```bash
npm install @rezzed.ai/memory
```

## Quick Start

```typescript
import { CacheBashMemory } from "@rezzed.ai/memory";

const memory = new CacheBashMemory({
  apiKey: "your-api-key",
  programId: "your-program-id",
  endpoint: "https://api.cachebash.dev/v1/mcp", // optional, this is the default
});

// Store a memory pattern
await memory.store({
  id: "pattern-001",
  domain: "workflow",
  pattern: "Always validate input before processing",
  confidence: 0.95,
  evidence: "Prevented 3 runtime errors in production",
});

// Recall all patterns
const patterns = await memory.recall();
console.log(patterns);

// Recall patterns by domain
const workflowPatterns = await memory.recall({ domain: "workflow" });

// Search patterns
const searchResults = await memory.recall({ search: "validate" });

// Get memory health stats
const health = await memory.health();
console.log(health);
// {
//   totalPatterns: 42,
//   promotedPatterns: 5,
//   stalePatterns: 2,
//   domains: ["workflow", "security", "performance"],
//   avgConfidence: 0.87,
//   ...
// }
```

## API Reference

### `CacheBashMemory`

Main client class for memory operations.

#### Constructor

```typescript
new CacheBashMemory(config: CacheBashMemoryConfig)
```

**Config:**
- `apiKey` (string, required) — Your CacheBash API key
- `programId` (string, required) — Program ID for memory isolation
- `endpoint` (string, optional) — MCP endpoint URL (default: `https://api.cachebash.dev/v1/mcp`)

#### Methods

##### `store(pattern: StorePatternInput): Promise<void>`

Store or update a memory pattern. If a pattern with the same `id` exists, it will be replaced.

**Pattern fields:**
- `id` (string) — Unique pattern identifier
- `domain` (string) — Domain category (e.g., "workflow", "security", "performance")
- `pattern` (string) — The learned pattern or rule
- `confidence` (number) — Confidence score (0-1)
- `evidence` (string) — Supporting evidence or context

##### `recall(options?: RecallOptions): Promise<MemoryPattern[]>`

Recall memory patterns with optional filters.

**Options:**
- `domain` (string, optional) — Filter by domain
- `search` (string, optional) — Text search across pattern and evidence fields

**Returns:** Array of `MemoryPattern` objects (excludes stale patterns by default)

##### `health(): Promise<MemoryHealth>`

Get memory health statistics.

**Returns:**
- `totalPatterns` — Total pattern count
- `promotedPatterns` — Patterns promoted to permanent storage
- `stalePatterns` — Patterns marked as stale
- `domains` — List of all domains
- `avgConfidence` — Average confidence score
- `oldestPattern` — Timestamp of oldest pattern
- `newestPattern` — Timestamp of newest pattern
- `decay` — Decay configuration (TTL, max age, etc.)

## Types

```typescript
interface MemoryPattern {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
  discoveredAt: string;
  lastReinforced: string;
  promotedToStore: boolean;
  stale: boolean;
}

interface MemoryHealth {
  totalPatterns: number;
  promotedPatterns: number;
  stalePatterns: number;
  domains: string[];
  avgConfidence: number;
  oldestPattern: string | null;
  newestPattern: string | null;
  decay: {
    contextSummaryTTLDays: number;
    learnedPatternMaxAge: number;
    maxUnpromotedPatterns: number;
    lastDecayRun: string;
  };
}
```

## License

MIT

## Links

- [CacheBash Documentation](https://rezzed.ai/cachebash)
- [GitHub Repository](https://github.com/rezzedai/cachebash)
- [Report Issues](https://github.com/rezzedai/cachebash/issues)
