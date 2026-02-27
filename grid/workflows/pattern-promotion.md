# Pattern Promotion Workflow

**Status:** Active
**Owner:** System (Cloud Function: onProgramStateWrite)
**Version:** 1.0

## Overview

Learned patterns that meet promotion criteria are automatically promoted from ephemeral program state to the permanent knowledge store. This workflow documents the promotion process and pattern format.

## Promotion Criteria

A learned pattern is eligible for promotion when ALL of the following are true:

1. **Confidence** >= 0.7
2. **Reinforced** at least once (lastReinforced !== discoveredAt)
3. **Not stale** (stale === false)
4. **Not already promoted** (promotedToStore === false)

## Promotion Process

### 1. Detection

The `onProgramStateWrite` Cloud Function monitors program state writes:

```typescript
// Triggered on: tenants/{userId}/sessions/_meta/program_state/{programId}
// Checks: learnedPatterns[] for promotion eligibility
```

### 2. Task Creation

When a pattern meets criteria, a task is created:

- **Target**: The program that discovered the pattern
- **Title**: `Promote pattern: {pattern.id} → grid/stores/patterns/{domain}/`
- **Priority**: low
- **Action**: queue

### 3. Pattern Write

The target program writes the pattern to the knowledge store:

**Path**: `grid/stores/patterns/{domain}/{slug}.md`

Where:
- `{domain}` = pattern.domain (dev, arch, security, content, product, ops)
- `{slug}` = pattern.id lowercased with non-alphanumeric chars replaced by `-`

### 4. Promotion Flag Update

After writing, the Cloud Function sets `promotedToStore: true` in program state.

## Pattern File Format

### Template

```markdown
# {Pattern Name}

**Domain:** {domain}
**Confidence:** {0.0 - 1.0}
**Discovered:** {ISO timestamp}
**Last Reinforced:** {ISO timestamp}
**Promoted:** {ISO timestamp}

## Pattern

{One-sentence description of the pattern}

## Evidence

{Evidence that supports this pattern - observations, examples, test results}

## Context

{When/where this pattern applies}

## Examples

{Code examples, scenarios, or cases where this pattern was observed}

## Related Patterns

- [{related-pattern-id}](../path/to/related-pattern.md)

---

*Promoted from program: {programId}*
*Session: {sessionId}*
```

### Example

```markdown
# Firebase Security Rules Require Source Field

**Domain:** security
**Confidence:** 0.85
**Discovered:** 2024-01-15T10:23:45Z
**Last Reinforced:** 2024-01-16T14:30:12Z
**Promoted:** 2024-01-16T15:00:00Z

## Pattern

Firebase security rules for relay messages must validate the `source` field matches the authenticated program ID to prevent spoofing.

## Evidence

Observed across 3 message-sending implementations. Initial implementation without source validation failed security audit. Adding `request.auth.token.programId == resource.data.source` check passed audit with 100% success rate.

## Context

Applies to all Firestore security rules for collections that store inter-program messages or tasks where source attribution is security-critical.

## Examples

```javascript
// BAD - no source validation
allow create: if request.auth != null;

// GOOD - source validation
allow create: if request.auth != null &&
               request.auth.token.programId == request.resource.data.source;
```

## Related Patterns

- [authentication-token-claims](./authentication-token-claims.md)
- [program-identity-verification](./program-identity-verification.md)

---

*Promoted from program: sark*
*Session: sark-2024-01-15*
```

## Best Practices

### Writing Patterns

1. **Be Specific**: Pattern should be actionable, not vague
2. **Include Evidence**: Always cite concrete observations
3. **Document Context**: Explain when/where pattern applies
4. **Link Related Patterns**: Build the knowledge graph
5. **Use Examples**: Code snippets or scenarios clarify intent

### Domain Selection

| Domain | Scope |
|--------|-------|
| `dev` | Development tooling, build systems, testing |
| `arch` | System architecture, schema design, technical assessment |
| `security` | Access control, audit, compliance, security rules |
| `content` | Documentation, communication, content strategy |
| `product` | Product design, UX, feature planning |
| `ops` | Infrastructure, DevOps, deployment, monitoring |

### Pattern Lifecycle

```
Discover → Reinforce → Promote → Store → Query
   ↑                                        ↓
   └────────── Refine/Update ──────────────┘
```

1. **Discover**: Program observes a pattern during work
2. **Reinforce**: Pattern validated in another context
3. **Promote**: Meets criteria, written to knowledge store
4. **Store**: Permanent markdown in git
5. **Query**: Available for search/reference
6. **Refine**: Pattern updated as system evolves

## Anti-Patterns

❌ **Don't**:
- Promote patterns with confidence < 0.7 (insufficient validation)
- Create patterns that are one-time solutions (not reusable)
- Write vague patterns ("be careful", "watch out for")
- Promote without reinforcement (single observation)
- Duplicate existing patterns (search first)

✅ **Do**:
- Validate patterns across multiple scenarios
- Write specific, actionable patterns
- Include measurable confidence scores
- Link to related patterns
- Keep patterns updated as system evolves

## Metadata

- **Created**: 2024-01-15
- **Last Updated**: 2024-01-15
- **Version**: 1.0
- **Authors**: Grid System
- **Status**: Active
