# Capability Gap Detection Workflow

**Status:** Active
**Owner:** ISO (Grid Orchestrator)
**Version:** 1.0

## Overview

When 3 or more tasks fail in the same domain within 30 days, the system automatically detects a **capability gap** and creates an analysis task for ISO to investigate root cause.

**Trigger**: Cloud Function `onTaskCompleteFailed` monitors task completions.

## Why Capability Gaps Matter

Task failures aren't random. Patterns emerge:
- Same type of task repeatedly fails
- Same program struggles with specific work
- Same domain has systemic issues

Capability gap detection surfaces these patterns before they become chronic problems.

## Detection Logic

### Trigger Conditions

A gap-analysis task is created when:

1. ✅ A task completes with `completed_status: "FAILED"`
2. ✅ 3+ tasks in the same **domain** failed in the last 30 days
3. ✅ No existing gap-analysis task for this domain (deduplication)

### Domain Mapping

Domains are derived from task `target` field:

| Program(s) | Domain |
|-----------|--------|
| basher, gem, rinzler, link, tron | dev |
| alan, radia | arch |
| sark, dumont | security |
| castor, scribe, sage | content |
| clu, quorra, casp | product |
| iso, bit, byte, gridbot, ram | ops |

### Gap Task Format

**Title**: `Capability gap detected: {domain}`

**Target**: `iso`

**Instructions**:
```
3+ failures detected in domain '{domain}' within 30 days.
Failed tasks: {task1Id} (title1), {task2Id} (title2), ...
Programs involved: {program1}, {program2}, ...
Investigate root cause per grid/workflows/capability-gap-detection.md.
```

## Investigation Protocol

When you receive a capability gap task:

### Step 1: Review Failed Tasks

1. Query task history for the domain:
   ```typescript
   // Get failed tasks in domain over last 30 days
   const failures = await query_tasks({
     status: "completed",
     completed_status: "FAILED",
     period: "this_month"
   });
   ```

2. Group by failure type:
   - **Common error codes**: Same underlying issue?
   - **Same task type**: Structural problem with task definition?
   - **Same program**: Specific program lacks capability?
   - **Same timeframe**: External dependency issue?

### Step 2: Root Cause Analysis

Ask the **5 Whys**:

1. **Why did Task X fail?**
   - Example: "Firebase security rules rejected the operation"

2. **Why were the rules incorrect?**
   - Example: "Program didn't validate source field"

3. **Why wasn't source field validated?**
   - Example: "Pattern not documented in knowledge store"

4. **Why wasn't pattern documented?**
   - Example: "No pattern extraction during previous session"

5. **Why no extraction?**
   - Example: "BIT gate wasn't enforced yet" (systemic issue)

### Step 3: Classify the Gap

| Gap Type | Characteristics | Solution |
|---------|----------------|----------|
| **Knowledge Gap** | Pattern exists but undocumented | Extract & promote pattern |
| **Tooling Gap** | Missing tool/library/integration | Add to program tooling |
| **Skill Gap** | Program lacks domain expertise | Training, config adjustment, or new program |
| **Process Gap** | Workflow undefined or broken | Create/update workflow docs |
| **Dependency Gap** | External service/API issue | Update integration, add retry logic |
| **Design Gap** | Systemic architectural issue | Council escalation, RFC |

### Step 4: Determine Solution

#### For Knowledge Gaps

1. Extract the missing pattern
2. Call `update_program_state()` with high confidence (0.8+)
3. Promote to `grid/stores/patterns/{domain}/`
4. Notify affected programs

#### For Tooling Gaps

1. Identify missing tool/library
2. Create task for builder to integrate
3. Document in program config
4. Test with failing scenario

#### For Skill Gaps

**Option A: Training** (existing program can learn)
- Update program state with learned patterns
- Add to config.knownQuirks[]
- Provide examples in knowledge store

**Option B: New Program** (needs specialized capability)
- Propose to Council
- Define program spec
- Create in Grid registry
- Route domain tasks to new program

#### For Process Gaps

1. Document missing workflow
2. Add to `grid/workflows/`
3. Reference in task templates
4. Notify affected programs

#### For Dependency Gaps

1. Identify unstable dependency
2. Add retry/backoff logic
3. Monitor for stability
4. Escalate if persistent

#### For Design Gaps

1. Document the systemic issue
2. Create RFC (Request for Comments)
3. Present to Council
4. Coordinate architecture change

### Step 5: Implement Solution

1. Create implementation tasks
2. Assign to appropriate programs
3. Set dependencies (if multi-phase)
4. Monitor completion

### Step 6: Validate Resolution

After implementation:

1. Re-run failing scenarios
2. Confirm success
3. Update gap-analysis task with outcome
4. Mark as complete

## Example: Real Capability Gap

### Detection

```
Title: Capability gap detected: security
Failed tasks:
- abc123 (Create API endpoint for user messages)
- def456 (Add relay message handler)
- ghi789 (Update task security rules)
Programs: basher, gem, alan
```

### Investigation

**5 Whys**:
1. Why failed? → Security rules rejected writes
2. Why rejected? → Missing source field validation
3. Why missing? → Not documented in patterns
4. Why not documented? → Pattern not extracted
5. Why not extracted? → SARK (security expert) never reviewed

**Classification**: Knowledge Gap (SARK's expertise not captured)

### Solution

1. **Pattern Extraction** (by SARK):
   ```typescript
   {
     id: "firestore-security-source-validation",
     domain: "security",
     pattern: "All inter-program writes must validate source === auth.programId",
     confidence: 0.9,
     evidence: "Prevents spoofing. Required by Firebase audit."
   }
   ```

2. **Promotion** to `grid/stores/patterns/security/firestore-security-source-validation.md`

3. **Notification** to basher, gem, alan

4. **Re-run** failing tasks → Success ✅

### Outcome

- Gap closed
- Pattern documented
- Future tasks succeed
- Knowledge captured

## Anti-Patterns

❌ **Don't**:
- Ignore gap-analysis tasks (they indicate systemic issues)
- Blame individual programs (gaps are system-level)
- Create new programs without validating need
- Fix symptoms without addressing root cause
- Escalate every gap to Council (many are simple knowledge/tooling gaps)

✅ **Do**:
- Investigate thoroughly before proposing solutions
- Extract patterns from gap analysis
- Document findings in knowledge store
- Test solutions before closing gap task
- Escalate only design gaps or skill gaps requiring new programs

## Metrics to Track

Monitor gap detection effectiveness:

| Metric | Target | Notes |
|--------|--------|-------|
| **Gap detection latency** | < 7 days | Time from 3rd failure to task creation |
| **Gap resolution time** | < 14 days | Time from detection to validated fix |
| **Repeat gaps** | 0 | Same gap shouldn't recur after resolution |
| **False positives** | < 10% | Gaps that aren't actually gaps |

Query metrics:

```typescript
const gaps = await query_tasks({
  title_contains: "Capability gap detected",
  period: "this_month"
});

const resolved = gaps.filter(t => t.status === "completed");
const avgResolutionTime = calculateAvg(resolved.map(t =>
  t.completedAt - t.createdAt
));
```

## Integration with Memory

Capability gaps often reveal missing patterns. After resolution:

1. Extract pattern if not already in knowledge store
2. Set high confidence (0.8+) since validated by failure analysis
3. Promote immediately to permanent store
4. Cross-reference in gap-analysis outcome

This ensures the Grid learns from failures and doesn't repeat them.

## Escalation Path

If gap analysis reveals:

| Scenario | Escalate To | Next Steps |
|---------|------------|------------|
| Missing pattern | — | Extract & promote (no escalation) |
| Missing tool | Builder program | Create integration task |
| Process undefined | ISO | Document workflow |
| Skill gap (trainable) | Target program | Update config + patterns |
| Skill gap (new program needed) | Council | RFC for new program |
| Design gap | Council | Architecture review, RFC |

## FAQ

**Q: What if failures are transient (network issues, etc.)?**
A: Root cause analysis will reveal this. Solution: Add retry logic, don't create new program.

**Q: Can I manually create a gap-analysis task?**
A: Yes. If you notice a pattern of failures before 3+ threshold, create task manually with "Proactive gap detection" in title.

**Q: What if the same domain has multiple distinct gaps?**
A: Create separate tasks for each gap type. Example: "Capability gap detected: security (rules)" vs "Capability gap detected: security (auth)".

**Q: How do I know if a gap is resolved?**
A: Re-run failing scenarios. If success rate is 100% for 1 week, gap is closed.

**Q: Should I extract patterns from gap analysis?**
A: Always. Gap analysis produces high-confidence patterns since they're validated by failure → fix → success cycle.

## Metadata

- **Created**: 2024-01-15
- **Last Updated**: 2024-01-15
- **Version**: 1.0
- **Authors**: ISO (Grid Orchestrator)
- **Status**: Active
- **Enforcement**: Automatic (Cloud Function)
