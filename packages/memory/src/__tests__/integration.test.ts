import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CacheBashMemory } from "../client.js";

const API_KEY = process.env.CACHEBASH_API_KEY;
const describeIf = API_KEY ? describe : describe.skip;

const TEST_PREFIX = "integration-test-";
const testIds: string[] = [];

function testId(suffix: string): string {
  const id = `${TEST_PREFIX}${suffix}`;
  testIds.push(id);
  return id;
}

describeIf("Integration Tests (live API)", () => {
  let memory: CacheBashMemory;

  beforeAll(() => {
    memory = new CacheBashMemory({
      apiKey: API_KEY!,
      programId: "integration-tests",
    });
  });

  afterAll(async () => {
    if (!memory) return;
    for (const id of testIds) {
      try {
        await memory.delete(id);
      } catch {
        // Pattern may not exist if test failed before store
      }
    }
  });

  it("store a pattern, recall it, verify fields match", async () => {
    const id = testId("store-recall");
    await memory.store({
      id,
      domain: "integration",
      pattern: "Test pattern for store-recall",
      confidence: 0.85,
      evidence: "Integration test evidence",
    });

    const patterns = await memory.recall({ domain: "integration" });
    const found = patterns.find((p) => p.id === id);

    expect(found).toBeDefined();
    expect(found!.domain).toBe("integration");
    expect(found!.pattern).toBe("Test pattern for store-recall");
    expect(found!.confidence).toBe(0.85);
    expect(found!.evidence).toBe("Integration test evidence");
  });

  it("recall with domain filter returns only matching patterns", async () => {
    const id = testId("domain-filter");
    await memory.store({
      id,
      domain: "unique-domain-filter-test",
      pattern: "Domain filter test pattern",
      confidence: 0.7,
      evidence: "Testing domain filter",
    });

    const results = await memory.recall({ domain: "unique-domain-filter-test" });

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const p of results) {
      expect(p.domain).toBe("unique-domain-filter-test");
    }
  });

  it("recall with search filter matches pattern text", async () => {
    const id = testId("search-filter");
    const uniquePhrase = "xyzzy-unique-search-phrase-42";
    await memory.store({
      id,
      domain: "integration",
      pattern: `Pattern containing ${uniquePhrase}`,
      confidence: 0.6,
      evidence: "Search filter test",
    });

    const results = await memory.recall({ search: uniquePhrase });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((p) => p.id === id);
    expect(found).toBeDefined();
  });

  it("reinforce updates confidence and lastReinforced timestamp", async () => {
    const id = testId("reinforce");
    await memory.store({
      id,
      domain: "integration",
      pattern: "Reinforce test pattern",
      confidence: 0.5,
      evidence: "Initial evidence",
    });

    const before = await memory.recall({ domain: "integration" });
    const patternBefore = before.find((p) => p.id === id);
    expect(patternBefore).toBeDefined();

    await new Promise((r) => setTimeout(r, 100));

    await memory.reinforce(id, {
      confidence: 0.9,
      evidence: "Reinforced evidence",
    });

    const after = await memory.recall({ domain: "integration" });
    const patternAfter = after.find((p) => p.id === id);

    expect(patternAfter).toBeDefined();
    expect(patternAfter!.confidence).toBe(0.9);
    expect(patternAfter!.lastReinforced).toBeDefined();
  });

  it("health returns valid stats", async () => {
    const health = await memory.health();

    expect(health.totalPatterns).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(health.domains)).toBe(true);
    expect(typeof health.activePatterns).toBe("number");
  });

  it("delete removes the pattern", async () => {
    const id = testId("delete");
    await memory.store({
      id,
      domain: "integration",
      pattern: "Pattern to delete",
      confidence: 0.5,
      evidence: "Will be deleted",
    });

    const before = await memory.recall({ search: id });
    expect(before.find((p) => p.id === id)).toBeDefined();

    await memory.delete(id);

    const after = await memory.recall({ search: id });
    expect(after.find((p) => p.id === id)).toBeUndefined();

    // Remove from cleanup list since already deleted
    const idx = testIds.indexOf(id);
    if (idx !== -1) testIds.splice(idx, 1);
  });

  it("store with duplicate ID upserts", async () => {
    const id = testId("upsert");
    await memory.store({
      id,
      domain: "integration",
      pattern: "Original pattern",
      confidence: 0.5,
      evidence: "Original evidence",
    });

    await memory.store({
      id,
      domain: "integration",
      pattern: "Updated pattern",
      confidence: 0.8,
      evidence: "Updated evidence",
    });

    const results = await memory.recall({ search: id });
    const found = results.find((p) => p.id === id);

    expect(found).toBeDefined();
    expect(found!.pattern).toBe("Updated pattern");
    expect(found!.confidence).toBe(0.8);
    expect(found!.evidence).toBe("Updated evidence");
  });
});
