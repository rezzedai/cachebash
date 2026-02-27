# Derez Pattern Extraction Protocol

**Status:** Active
**Owner:** BIT (Derez Gate Enforcer)
**Version:** 1.0

## Overview

Before a Grid program session completes (derezzed), the program MUST extract learned patterns from the session and update program state. The BIT gate enforces this requirement.

**Enforcement**: Cloud Function `onSessionComplete` blocks derez if pattern extraction is incomplete.

## Why Pattern Extraction Matters

Every session produces knowledge. Without extraction:
- ❌ Knowledge is lost when the session ends
- ❌ Future sessions repeat the same mistakes
- ❌ The Grid doesn't learn or improve
- ❌ Memory becomes a cost, not an asset

With extraction:
- ✅ Knowledge accumulates across sessions
- ✅ Programs build on previous work
- ✅ Common patterns get reinforced and promoted
- ✅ Memory becomes queryable infrastructure

## The Derez Gate

### How It Works

1. Program calls `update_session(status: "...", state: "complete")`
2. BIT gate fires (onSessionComplete Cloud Function)
3. BIT checks:
   - Was `update_program_state()` called during this session?
   - Does `learnedPatterns[]` have at least 1 entry?
4. If **YES**: Derez approved ✅
5. If **NO**: Derez blocked ❌
   - Session state reverted to "working"
   - High-priority DIRECTIVE task sent to program
   - Derez cannot proceed until extraction completed

### Gate Logic

```typescript
// Check 1: Program state updated during session
const stateUpdatedDuringSession = stateUpdateTime > sessionStartTime;

// Check 2: Patterns extracted
const hasPatternsExtracted = learnedPatterns.length > 0;

// Gate decision
if (!stateUpdatedDuringSession || !hasPatternsExtracted) {
  blockDerez(); // Revert to working, send DIRECTIVE
}
```

## Extraction Protocol

### Step 1: Reflect on Session

Before completing your session, ask:
- What did I learn that future sessions should know?
- What mistakes did I make? What worked well?
- What patterns did I observe in the codebase?
- What assumptions were validated or invalidated?

### Step 2: Identify Patterns

A pattern should be:
- **Reusable**: Applies to more than this one scenario
- **Actionable**: Concrete enough to guide future behavior
- **Validated**: Observed/tested, not just hypothetical
- **Specific**: Clear about when/where it applies

**Examples of Good Patterns**:
- "Firebase security rules for {collection} require {field} validation"
- "Task claim failures are usually transient — retry with exponential backoff"
- "Test files in this repo use jest with --detectOpenHandles flag to prevent hangs"
- "API rate limits reset at midnight UTC — batch operations should chunk at 23:59"

**Examples of Bad Patterns** (too vague):
- "Be careful with security rules"
- "Tests sometimes fail"
- "API has rate limits"

### Step 3: Structure Pattern Entries

Each `learnedPattern` entry must include:

```typescript
{
  id: string;              // Unique ID (kebab-case recommended)
  domain: string;          // dev, arch, security, content, product, ops
  pattern: string;         // One-sentence description (max 500 chars)
  confidence: number;      // 0.0 - 1.0 (how sure are you?)
  evidence: string;        // What supports this pattern? (max 500 chars)
  discoveredAt: string;    // ISO timestamp
  lastReinforced: string;  // ISO timestamp (same as discoveredAt if new)
}
```

### Step 4: Set Confidence Levels

| Confidence | Meaning |
|-----------|---------|
| 0.0 - 0.3 | Hypothesis (not validated) |
| 0.4 - 0.6 | Observed once or twice |
| 0.7 - 0.8 | Validated across multiple scenarios |
| 0.9 - 1.0 | Core architectural pattern, extensively tested |

**Promotion threshold**: 0.7+ with at least one reinforcement

### Step 5: Call update_program_state()

```typescript
await update_program_state({
  programId: "your-program-id",
  sessionId: "current-session-id",
  learnedPatterns: [
    {
      id: "firebase-rules-source-validation",
      domain: "security",
      pattern: "Firebase security rules must validate source field matches auth programId",
      confidence: 0.85,
      evidence: "Observed in 3 implementations. Audit failed without check, passed with check.",
      discoveredAt: "2024-01-15T10:23:45Z",
      lastReinforced: "2024-01-15T10:23:45Z",
    },
    // ... more patterns
  ],
});
```

### Step 6: Complete Session

After extraction:

```typescript
await update_session({
  status: "Session complete — extracted N patterns",
  state: "complete",
  progress: 100,
});
```

BIT gate will now approve derez.

## Reinforcement Protocol

If a pattern from a previous session is observed again:

1. Read current program state: `get_program_state(programId)`
2. Find matching pattern by `id` in `learnedPatterns[]`
3. Update:
   - `lastReinforced`: current timestamp
   - `confidence`: increase by 0.05 - 0.15 (judgment call)
4. Call `update_program_state()` with updated patterns

**Example**:

```typescript
// Session A (discovery)
{
  id: "test-jest-detect-handles",
  confidence: 0.6,
  lastReinforced: "2024-01-10T12:00:00Z"
}

// Session B (reinforcement)
{
  id: "test-jest-detect-handles",
  confidence: 0.75,  // +0.15
  lastReinforced: "2024-01-12T15:30:00Z"  // Updated
}
```

## Common Failure Modes

### "I forgot to extract patterns"

**Solution**: BIT gate will block derez and send DIRECTIVE. Extract patterns then retry.

### "I don't know what patterns to extract"

**Solution**: Look for:
- Configuration values that aren't documented
- Retry/backoff strategies that work
- Common error modes and their fixes
- Tool flags or options that matter
- Architectural decisions and their rationale

### "My session was short — no patterns learned"

**Response**: Even short sessions usually validate or invalidate something. Examples:
- "Confirmed X still works" (reinforce existing pattern, confidence +0.05)
- "Y is no longer needed" (mark pattern as stale)
- "Z configuration changed" (new pattern, confidence 0.5)

If truly nothing learned, extract a single pattern documenting that:

```typescript
{
  id: "no-op-session-2024-01-15",
  domain: "ops",
  pattern: "Routine check-in — no changes needed",
  confidence: 0.3,
  evidence: "Session performed status check, no issues found",
  discoveredAt: "2024-01-15T10:00:00Z",
  lastReinforced: "2024-01-15T10:00:00Z"
}
```

### "Patterns already promoted — should I extract again?"

**No.** Promoted patterns (promotedToStore: true) don't decay and don't need re-extraction. Focus on new patterns or reinforcing unpromoted ones.

## Integration with Promotion

When a pattern reaches:
- Confidence >= 0.7
- Reinforced at least once
- Not stale

The `onProgramStateWrite` Cloud Function will:
1. Create a promotion task
2. Write pattern to `grid/stores/patterns/{domain}/{slug}.md`
3. Set `promotedToStore: true`

See: [pattern-promotion.md](./pattern-promotion.md)

## FAQ

**Q: How many patterns should I extract per session?**
A: Quality over quantity. 1-5 high-confidence patterns > 20 vague ones.

**Q: Can I extract patterns for another program's domain?**
A: Yes! If you observe a security pattern while doing dev work, extract it with domain: "security".

**Q: What if I'm unsure about confidence level?**
A: Start conservative (0.4-0.6). Reinforce in future sessions to increase confidence.

**Q: Do I need to extract patterns every session?**
A: Yes. BIT gate enforces this. Even if it's just reinforcing existing patterns or noting "no-op session".

**Q: What happens to extracted patterns?**
A:
1. Stored in program state (ephemeral, decays)
2. If high confidence + reinforced → promoted to permanent store
3. Permanent store is queryable, searchable, versioned in git

**Q: Can I delete stale patterns?**
A: Patterns marked `stale: true` are automatically evicted by decay logic. Don't delete manually — mark as stale instead.

## Metadata

- **Created**: 2024-01-15
- **Last Updated**: 2024-01-15
- **Version**: 1.0
- **Authors**: BIT (Grid Enforcer)
- **Status**: Active
- **Enforcement**: Mandatory (BIT gate blocks derez)
