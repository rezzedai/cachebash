/**
 * @rezzed.ai/memory — Basic Usage Example
 *
 * Run: npx tsx packages/memory/examples/basic-usage.ts
 * Requires: CACHEBASH_API_KEY environment variable
 */

import { CacheBashMemory } from '@rezzed.ai/memory';

const memory = new CacheBashMemory({
  apiKey: process.env.CACHEBASH_API_KEY!,
  programId: process.env.CACHEBASH_PROGRAM_ID || 'example-program',
  transport: 'rest',
});

async function main() {
  // 1. Store a learned pattern
  await memory.store({
    id: 'example-001',
    domain: 'customer-support',
    pattern: 'Billing questions in the first 2 minutes correlate with churn risk',
    confidence: 0.85,
    evidence: 'Observed in 12 of 15 escalated support calls',
  });
  console.log('Stored pattern: example-001');

  // 2. Recall patterns by domain
  const patterns = await memory.recall({ domain: 'customer-support' });
  console.log(`Recalled ${patterns.length} pattern(s):`);
  patterns.forEach((p) => {
    console.log(`  [${p.confidence}] ${p.pattern}`);
  });

  // 3. Reinforce with new evidence
  await memory.reinforce('example-001', {
    confidence: 0.90,
    evidence: 'Confirmed in 3 additional calls this week',
  });
  console.log('Reinforced pattern: example-001');

  // 4. Check memory health
  const health = await memory.health();
  console.log(`Memory health: ${health.activePatterns} active, ${health.stalePatterns} stale`);

  // 5. Clean up
  await memory.delete('example-001');
  console.log('Deleted pattern: example-001');
}

main().catch(console.error);
