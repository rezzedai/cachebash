/**
 * @rezzed.ai/memory — Latency Benchmarks
 *
 * Run: CACHEBASH_API_KEY=xxx npx tsx packages/memory/benchmarks/latency.ts
 * Measures: store, recall, health, delete latency over N iterations
 */

import { CacheBashMemory } from "../src/client.js";

const API_KEY = process.env.CACHEBASH_API_KEY;
if (!API_KEY) {
  console.error("CACHEBASH_API_KEY is required");
  process.exit(1);
}

const ITERATIONS = 10;
const PREFIX = "benchmark-";

const memory = new CacheBashMemory({
  apiKey: API_KEY,
  programId: "benchmark",
});

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatRow(label: string, times: number[]): string {
  const sorted = [...times].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  return `${label.padEnd(11)}p50: ${String(p50).padStart(4)}ms  p95: ${String(p95).padStart(4)}ms  p99: ${String(p99).padStart(4)}ms`;
}

async function measure(fn: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

async function run() {
  console.log("@rezzed.ai/memory Latency Benchmark");
  console.log("=====================================");

  const storeTimes: number[] = [];
  const recallTimes: number[] = [];
  const recallDomainTimes: number[] = [];
  const healthTimes: number[] = [];
  const deleteTimes: number[] = [];

  // Store patterns
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measure(() =>
      memory.store({
        id: `${PREFIX}${i}`,
        domain: "benchmark",
        pattern: `Benchmark pattern ${i}`,
        confidence: 0.5 + i * 0.05,
        evidence: `Benchmark evidence ${i}`,
      })
    );
    storeTimes.push(ms);
  }

  // Recall (no filter)
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measure(() => memory.recall());
    recallTimes.push(ms);
  }

  // Recall (domain filter)
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measure(() => memory.recall({ domain: "benchmark" }));
    recallDomainTimes.push(ms);
  }

  // Health
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measure(() => memory.health());
    healthTimes.push(ms);
  }

  // Delete
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measure(() => memory.delete(`${PREFIX}${i}`));
    deleteTimes.push(ms);
  }

  console.log(formatRow("store()", storeTimes));
  console.log(formatRow("recall()", recallTimes));
  console.log(formatRow("recall(d)", recallDomainTimes));
  console.log(formatRow("health()", healthTimes));
  console.log(formatRow("delete()", deleteTimes));
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
