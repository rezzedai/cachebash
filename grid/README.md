# The Grid - CacheBash Knowledge Store

**Memory as Product - Phase 1**

The Grid is CacheBash's permanent knowledge store. Every session produces knowledge. The Grid preserves it, promotes it, and makes it queryable.

## What is The Grid?

The Grid is the multi-agent system running on CacheBash. Programs (AI agents) like BASHER, ALAN, SARK, and others work together to build, design, secure, and maintain software projects. The Grid infrastructure captures and preserves what these programs learn.

**Key insight**: AI sessions are ephemeral, but knowledge shouldn't be.

## Memory Lifecycle

```
┌─────────────┐
│  Discovery  │  Program observes a pattern during work
└──────┬──────┘
       │
       ▼
┌─────────────┐
│Reinforcement│  Pattern validated in another context
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Promotion  │  High-confidence patterns → knowledge store
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Storage   │  Permanent markdown in git (this directory)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    Query    │  Search, reference, build on previous work
└─────────────┘
```

## Directory Structure

```
grid/
├── README.md                    # This file
├── stores/
│   └── patterns/               # Permanent pattern storage
│       ├── dev/                # Development patterns
│       ├── arch/               # Architecture patterns
│       ├── security/           # Security patterns
│       ├── content/            # Content/documentation patterns
│       ├── product/            # Product design patterns
│       └── ops/                # Operations patterns
└── workflows/                  # Workflow documentation
    ├── pattern-promotion.md
    ├── derez-pattern-extraction.md
    └── capability-gap-detection.md
```

## How It Works

### 1. Pattern Discovery

During a session, programs extract learned patterns:

```typescript
await update_program_state({
  programId: "basher",
  sessionId: "basher-2024-01-15",
  learnedPatterns: [
    {
      id: "jest-detect-open-handles",
      domain: "dev",
      pattern: "Jest tests with Firebase need --detectOpenHandles flag",
      confidence: 0.6,
      evidence: "Observed 8/12 tests hanging without flag",
      discoveredAt: "2024-01-15T10:00:00Z",
      lastReinforced: "2024-01-15T10:00:00Z"
    }
  ]
});
```

**Where stored**: Firestore `program_state` collection (ephemeral, decays after 7-30 days)

### 2. Pattern Reinforcement

In a later session, the pattern is observed again:

```typescript
// Read previous state
const state = await get_program_state({ programId: "basher" });

// Find pattern
const pattern = state.learnedPatterns.find(p => p.id === "jest-detect-open-handles");

// Update confidence and reinforcement timestamp
pattern.confidence = 0.75;  // +0.15
pattern.lastReinforced = new Date().toISOString();

// Write back
await update_program_state({
  programId: "basher",
  learnedPatterns: state.learnedPatterns
});
```

### 3. Automatic Promotion

When a pattern meets criteria:
- Confidence >= 0.7
- Reinforced at least once
- Not stale

A Cloud Function automatically:
1. Creates a promotion task
2. Writes pattern to `grid/stores/patterns/{domain}/{slug}.md`
3. Sets `promotedToStore: true`

**Where stored**: Git repository (permanent, versioned)

### 4. Knowledge Query

Patterns in the Grid are:
- ✅ Searchable (grep, GitHub search, IDE search)
- ✅ Versioned (git history)
- ✅ Cross-referenced (markdown links)
- ✅ Documented (evidence, examples, context)

```bash
# Search for Firebase patterns
grep -r "Firebase" grid/stores/patterns/

# Search for high-confidence patterns
grep "Confidence: 0.9" grid/stores/patterns/**/*.md

# Search by domain
ls grid/stores/patterns/security/
```

## Pattern Format

Every pattern is a markdown file with:

```markdown
# {Pattern Name}

**Domain:** {dev|arch|security|content|product|ops}
**Confidence:** {0.0 - 1.0}
**Discovered:** {ISO timestamp}
**Last Reinforced:** {ISO timestamp}
**Promoted:** {ISO timestamp}

## Pattern
{One-sentence description}

## Evidence
{Concrete observations, test results}

## Context
{When/where this applies}

## Examples
{Code snippets, scenarios}

## Related Patterns
- [pattern-id](../domain/pattern-id.md)
```

See: [pattern-promotion.md](workflows/pattern-promotion.md)

## Enforcement

### BIT Derez Gate

Programs MUST extract patterns before session completion. The BIT gate blocks derez if:
- `update_program_state()` not called during session
- `learnedPatterns[]` is empty

See: [derez-pattern-extraction.md](workflows/derez-pattern-extraction.md)

### Decay Policies

Unpromoted patterns decay:
- **Context summary**: Cleared after 7 days (if task completed)
- **Patterns**: Marked stale after 30 days (if not reinforced)
- **Max unpromoted**: 50 patterns (lowest confidence evicted)

**Promoted patterns never decay**.

## Capability Gap Detection

When 3+ tasks fail in the same domain within 30 days:
- System creates gap-analysis task for ISO
- Investigation reveals missing patterns
- Patterns extracted and promoted
- Gap closed

See: [capability-gap-detection.md](workflows/capability-gap-detection.md)

## Benefits

### For Programs

- ✅ Build on previous work (don't repeat discoveries)
- ✅ Avoid known failure modes
- ✅ Faster execution (leverage knowledge)
- ✅ Higher success rates

### For Users

- ✅ Visible knowledge accumulation
- ✅ Queryable memory (search patterns)
- ✅ System that learns and improves
- ✅ Reduced repetitive errors

### For The Grid

- ✅ Collective intelligence (programs share knowledge)
- ✅ Self-improving system
- ✅ Capability gap detection
- ✅ Knowledge compounds over time

## Current Patterns

```bash
# Count patterns by domain
find grid/stores/patterns -name "*.md" | wc -l

# List by domain
ls -1 grid/stores/patterns/*/
```

As of 2024-01-15:
- **dev**: 1 pattern (jest-detect-open-handles)
- **arch**: 1 pattern (firestore-tenant-isolation)
- **security**: 1 pattern (firestore-security-source-validation)
- **product**: 1 pattern (user-feedback-rapid-iteration)
- **content**: 0 patterns
- **ops**: 0 patterns

**Total**: 4 patterns (bootstrap examples)

## Roadmap

### Phase 1 (Current)
- ✅ Directory structure
- ✅ Workflow documentation
- ✅ Example patterns
- ✅ README

### Phase 2 (Planned)
- [ ] Pattern search MCP tools
- [ ] Pattern query by domain/confidence
- [ ] Pattern analytics (most reinforced, highest confidence)
- [ ] Pattern visualization in portal

### Phase 3 (Future)
- [ ] Pattern relationships graph
- [ ] Auto-suggest patterns during task execution
- [ ] Pattern A/B testing (confidence validation)
- [ ] Cross-program pattern recommendations

## Contributing

### Adding Patterns Manually

If you discover a pattern outside the automatic promotion flow:

1. Create file: `grid/stores/patterns/{domain}/{pattern-id}.md`
2. Use template from [pattern-promotion.md](workflows/pattern-promotion.md)
3. Set confidence conservatively (0.5-0.6 for manual additions)
4. Commit to git
5. Programs will discover and may reinforce

### Updating Existing Patterns

When a pattern evolves:

1. Read current file
2. Update evidence, examples, or confidence
3. Update "Last Reinforced" timestamp
4. Commit with clear message: `"Reinforced pattern: {id}"`

### Deprecating Patterns

When a pattern becomes obsolete:

1. Add `**Status: Deprecated**` to header
2. Explain why (migration, architecture change, etc.)
3. Link to replacement pattern if applicable
4. Keep file (historical value)

## FAQ

**Q: Why markdown in git instead of database?**
A:
- Git provides versioning, diff, blame
- Markdown is human-readable
- Works with existing dev tools (grep, IDE search)
- Can be referenced in docs/code comments
- Forks and PRs work naturally

**Q: What's the difference between program state and the Grid?**
A:
- **Program state**: Ephemeral, per-program, decays
- **The Grid**: Permanent, cross-program, versioned

Program state is working memory. The Grid is long-term memory.

**Q: Can I query patterns programmatically?**
A: Phase 2 will add MCP tools. For now, use:
```bash
grep -r "pattern text" grid/stores/patterns/
```

**Q: How do I know if a pattern is high quality?**
A:
- Confidence >= 0.8
- Multiple reinforcements (check git log)
- Concrete evidence and examples
- Clear context and constraints

**Q: What if two patterns conflict?**
A:
- Check confidence scores
- Check reinforcement counts (git log)
- Prefer promoted over unpromoted
- Test both, update the weaker one

**Q: Can I search patterns from MCP?**
A: Not yet. Phase 2 will add:
- `search_patterns({ query, domain, minConfidence })`
- `get_pattern({ id })`
- `list_patterns({ domain, sortBy })`

## Metadata

- **Created**: 2024-01-15
- **Last Updated**: 2024-01-15
- **Version**: 1.0
- **Phase**: 1 (Bootstrap)
- **Status**: Active
- **Owner**: The Grid
