# Authz chokepoint — §2 enumeration checklist (PR-2)

Committed reviewable checklist for `PDR-cachebash-authz-chokepoint.md` / `ISO-plan-authz-chokepoint.md` §2. This is
the enumeration artifact only — **no authorization decisions are added or changed by this document or by PR-2**.
VECTOR/ISO review this site-by-site to close the plan's PR-2 gate: "VECTOR reviews §2; zero unassigned sites."

Base commit: `adaf9a5` (PR-1 merged/deployed, `cachebash-mcp-00191-z4z`).

## Predicate

Per the PDR/plan §2: *any handler that reads a program, session, agent, target or source identifier from its
arguments and uses it to select, mutate or destroy data.*

## Method (independently re-derived, not copied from the plan)

The plan's §0.3 warns that a naive `args.X`-only grep undercounts: it also matches `query.X`, `body.X`,
`req.params|query|body.X`, and destructured forms (`const { target, ... } = args`), which hide sites in
`keys.ts` and `wake/onDemandWake.ts`.

The re-derived sweep used:

```
grep -noE '\b(args|query|body|req\.(params|query|body))\.(agentId|target|targetProgram|sessionId|programId|source)\b'
```

against every `.ts` file under `services/mcp-server/src/{modules,transport,iso}`, plus manual inspection for
destructured reads the regex structurally cannot see (confirmed exactly two: `modules/keys.ts:45` and
`modules/wake/onDemandWake.ts:208`, both flagged by name in the plan's §0.3).

A broader keyword list (`owner`, `ownerId`, `program`, `principal`, `userId`, `uid`, `to`, `from`, `recipient`,
`assignee`, `scheduleOwner`, `forProgram`) was tried first, to check whether the PDR's five-keyword predicate
(`agentId`, `target`, `sessionId`, `programId`, `source`) was under-inclusive. It was not: none of those extra
keywords matched anywhere in the swept files. The five-keyword predicate is exhaustive against the actual tree.

## Reconciliation: 258 / 258 — matches the plan exactly, per file

| File | This sweep | Plan §2 | Match |
|---|---|---|---|
| `modules/programState.ts` | 74 | 74 | ✅ |
| `modules/relay.ts` | 41 | 41 | ✅ |
| `modules/dispatch/dispatchHandler.ts` | 36 | 36 | ✅ |
| `modules/pulse.ts` | 21 | 21 | ✅ |
| `modules/dispatch/tasks.ts` | 14 | 14 | ✅ |
| `modules/dispatch/interventions.ts` | 14 | 14 | ✅ |
| `modules/dispatch/claims.ts` | 10 | 10 | ✅ |
| `modules/schedule.ts` | 9 | 9 | ✅ |
| `modules/gsp.ts` | 9 | 9 | ✅ |
| `modules/programRegistry.ts` | 6 | 6 | ✅ |
| `modules/rate-limits.ts` | 4 | 4 | ✅ |
| `modules/metrics.ts` | 3 | 3 | ✅ |
| `modules/ack-compliance.ts` | 3 | 3 | ✅ |
| `modules/trace.ts` | 2 | 2 | ✅ |
| `modules/audit.ts` | 2 | 2 | ✅ |
| `modules/sprint.ts` | 1 | 1 | ✅ |
| `modules/signal.ts` | 1 | 1 | ✅ |
| `modules/keys.ts` (destructured, manual) | 1 | 1 | ✅ DONE, PR-1 |
| `modules/wake/onDemandWake.ts` (destructured, manual) | 1 | 1 | ✅ |
| **Module subtotal** | **252** | **252** | ✅ |
| `transport/rest.ts` | 6 | 6 | ✅ |
| `iso/isoServer.ts` | 0 | 0 | ✅ (thin dispatcher onto the same handlers — §0.1) |
| **Total** | **258** | **258** | ✅ |

No discrepancy to report: the independently re-derived count reconciles exactly to the plan's claimed 258 across
20 files and 3 transports. No 259th site was found. (One line-counting note: like the plan's own count, a single
source line that reads two identifiers — e.g. `args.source ? args.source : ...` or
`args.target !== self && args.target !== "all"` — is counted once per identifier occurrence, not once per line;
several such lines appear in `relay.ts`, `dispatchHandler.ts`, `tasks.ts`, and `schedule.ts` in the appendix below,
each occurrence listed as its own row for that reason.)

## Disposition vocabulary

Per the plan's §4.2 / §2 preamble: **SELF-ONLY** / **FOREIGN-READ** (fleet-read capability) / **FOREIGN-WRITE**
(admin capability). Default for anything unclassified is SELF-ONLY. Dispositions below are the plan's own
per-file assignments (§2.1/§2.2/§2.3), applied to each site; they are ISO's assignment, not re-litigated here,
**except** where flagged as an escalation (see "Escalations" below and inline in the appendix).

## `credentialPrincipal` adoption (PR-2 scope: swap only where behavior-identical)

Searched every `auth.programId` read and every `isAdmin`/`hasCapability` call site in the module layer for a
literal drop-in match to `credentialPrincipal(auth)` (`auth.keyProgramId ?? auth.programId`, from
`auth/ownerAuthz.ts`). Only **one** true drop-in existed:

- **`transport/rest.ts:478`** (portal owner send-message, `POST /v1/relay/messages`) previously computed
  `const source = auth.keyProgramId ?? auth.programId;` inline — byte-for-byte the same expression
  `credentialPrincipal()` returns. Swapped to `const source = credentialPrincipal(auth);` (see diff). This is
  provably behavior-identical: same inputs (`auth.keyProgramId`, `auth.programId`), same operator (`??`), same
  output type coerced to `string`. Covered by `__tests__/portal-owner-send-message.test.ts`, which passes
  unchanged (see verification below).

**Everywhere else `isAdmin(auth)` is called** (`relay.ts`, `pulse.ts`, `programRegistry.ts`, `metrics.ts`,
`audit.ts`, `trace.ts`, `claims.ts`, `completion.ts`), it resolves via `(ADMIN_PROGRAMS).includes(auth.programId)`
— **list membership against `auth.programId`**, not an identity resolution against
`auth.keyProgramId ?? auth.programId`. `auth.programId` is the X-Program-Id-overridable field (BUG-006); under a
header override `auth.programId` and `credentialPrincipal(auth)` can diverge. Swapping `isAdmin`'s internals, or
swapping its call sites' input from `auth.programId` to `credentialPrincipal(auth)`, would be a **behavior
change** (and in the override case, arguably a bug fix) — not "identical for every input." Per instructions, left
untouched and noted in the appendix for a later PR (the plan already assigns this: "Both primitives here are the
broken ones (§0.2) — replace, don't reuse" is PR-4/PR-5 territory, not PR-2's no-behavior-change scope).

No other inline `auth.keyProgramId ?? auth.programId` (or equivalent) expression exists anywhere else in
`services/mcp-server/src` — confirmed by grepping every `keyProgramId` reference in the tree.

## Escalations to BASHER

1. **`modules/pulse.ts` — `getContextUtilizationHandler` (lines 727, 729, 754).** The plan's prose names only
   three of pulse.ts's handlers explicitly (`pulse_update_session` SELF-ONLY, `get_fleet_health` FOREIGN-READ,
   `pause`/`resume_program` FOREIGN-WRITE), even though its 21-site count includes this handler's 3 sites.
   `getContextUtilizationHandler` takes `args.sessionId` and, when supplied, reads
   `tenants/{userId}/sessions/{args.sessionId}` and returns that session's **full `contextHistory`** — with
   **no gate of any kind**, not even a broken one (no `isAdmin`, no self-comparison). Worse: the no-`sessionId`
   branch unconditionally aggregates and returns **every active session's** context summary fleet-wide,
   regardless of caller. This is currently reachable by any valid key today (pre-existing, not introduced by
   PR-2 — no behavior changed here). Structurally it looks like it should be FOREIGN-READ (same shape as
   `get_fleet_health`, which the plan does name), but the plan's text never assigns it a disposition, so per §5's
   own instruction ("never ship a SELF-ONLY on a site you have not confirmed") I have not assumed one. Flagged
   in the appendix as `UNASSIGNED IN PLAN PROSE` rather than silently defaulted to SELF-ONLY or silently
   upgraded to FOREIGN-READ. No code changed here — PR-2 makes no authz decisions.
2. **D4 (relay.ts broadcast exemption) encountered, not resolved.** `relay.ts` has a `t === "all"` broadcast
   exemption at the read-filter sites (around lines 472, 477, 743) that the plan explicitly flags as unresolved
   ("whether a broadcast message read by a non-owner is legitimate") and instructs not to assume an answer on.
   Confirmed present, confirmed untouched — noted in the appendix per-row, not adjudicated.
3. No site was found that the plan's §2 does not list — the 258 reconciles exactly (see above), so there is no
   259th-site finding to escalate.
4. No disposition in the plan's §2 was found to be evidently wrong (as distinct from item 1's "not stated").

## Verification (before / after — PR-2 changes only)

Baseline run (before any PR-2 change), `npx jest` in `services/mcp-server`:

```
Test Suites: 1 skipped, 57 passed, 57 of 58 total
Tests:       21 skipped, 863 passed, 884 total
```

Post-change run (after the `credentialPrincipal` swap in `transport/rest.ts`):

```
Test Suites: 1 skipped, 57 passed, 57 of 58 total
Tests:       21 skipped, 863 passed, 884 total
```

Identical pass/fail set — zero tests changed status, including `portal-owner-send-message.test.ts` (the direct
coverage of the swapped line), which passed both before and after.

---

## Appendix — every site, file:line, identifier, disposition


### `modules/programState.ts` — 74 site(s)

Primitive present in file: **verifySource**. Default disposition: **SELF-ONLY (enforced — reference impl, confirm only)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 230 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 231 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 234 | `args.programId` | `if (!canRead(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 235 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read state for` | SELF-ONLY (enforced — reference impl, confirm only) |
| 239 | `args.programId` | `if (auth.programId !== args.programId) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 244 | `args.programId` | `target_program: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 250 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 257 | `args.programId` | `state: defaultState(args.programId, "none"),` | SELF-ONLY (enforced — reference impl, confirm only) |
| 258 | `args.programId` | `message: `No persisted state for "${args.programId}". Returning defaults.`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 280 | `args.programId` | `program_id: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 291 | `args.programId` | `message: `State loaded for "${args.programId}".${decayed ? ` Decay applied: ${patternsMarkedStale} p` | SELF-ONLY (enforced — reference impl, confirm only) |
| 322 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 323 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 326 | `args.programId` | `if (!canWrite(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 327 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory f` | SELF-ONLY (enforced — reference impl, confirm only) |
| 331 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 335 | `args.programId` | `const base = existing.exists ? existing.data()! : defaultState(args.programId, "unknown");` | SELF-ONLY (enforced — reference impl, confirm only) |
| 367 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 371 | `args.programId` | `message: `Pattern "${args.pattern.id}" ${existingIdx >= 0 ? "updated" : "stored"} for "${args.progra` | SELF-ONLY (enforced — reference impl, confirm only) |
| 382 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 383 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 386 | `args.programId` | `if (!canRead(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 387 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read memory fo` | SELF-ONLY (enforced — reference impl, confirm only) |
| 391 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 397 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 400 | `args.programId` | `message: `No memory found for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 434 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 443 | `args.programId` | `message: `Found ${patterns.length} pattern(s) for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 454 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 455 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 458 | `args.programId` | `if (!canRead(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 459 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read memory he` | SELF-ONLY (enforced — reference impl, confirm only) |
| 463 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 469 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 480 | `args.programId` | `message: `No memory state for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 494 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 510 | `args.programId` | `message: `Memory health for "${args.programId}": ${activePatterns.length} active, ${stalePatterns.le` | SELF-ONLY (enforced — reference impl, confirm only) |
| 517 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 518 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 521 | `args.programId` | `if (!canWrite(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 522 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write state fo` | SELF-ONLY (enforced — reference impl, confirm only) |
| 526 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 530 | `args.programId` | `const base = existing.exists ? existing.data()! : defaultState(args.programId, args.sessionId \|\| "` | SELF-ONLY (enforced — reference impl, confirm only) |
| 530 | `args.sessionId` | `const base = existing.exists ? existing.data()! : defaultState(args.programId, args.sessionId \|\| "` | SELF-ONLY (enforced — reference impl, confirm only) |
| 534 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 536 | `args.programId` | `lastUpdatedBy: auth.programId === "legacy" \|\| auth.programId === "mobile" ? args.programId : auth.` | SELF-ONLY (enforced — reference impl, confirm only) |
| 538 | `args.sessionId` | `sessionId: args.sessionId \|\| base.sessionId \|\| "unknown",` | SELF-ONLY (enforced — reference impl, confirm only) |
| 612 | `args.programId` | `const historyRef = db.collection(`tenants/${auth.userId}/sessions/_meta/program_state/${args.program` | SELF-ONLY (enforced — reference impl, confirm only) |
| 640 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 650 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 652 | `args.programId` | `message: `State updated for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 670 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 671 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 674 | `args.programId` | `if (!canWrite(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 675 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory f` | SELF-ONLY (enforced — reference impl, confirm only) |
| 679 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 683 | `args.programId` | `return jsonResult({ success: false, error: `No memory state for "${args.programId}".` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 705 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 708 | `args.programId` | `message: `Pattern "${args.patternId}" deleted from "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 727 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 728 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 731 | `args.programId` | `if (!canWrite(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 732 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory f` | SELF-ONLY (enforced — reference impl, confirm only) |
| 736 | `args.programId` | `const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);` | SELF-ONLY (enforced — reference impl, confirm only) |
| 740 | `args.programId` | `return jsonResult({ success: false, error: `No memory state for "${args.programId}".` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 768 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 771 | `args.programId` | `message: `Pattern "${args.patternId}" reinforced for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 787 | `args.programId` | `if (!(await isProgramRegistered(auth.userId, args.programId))) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 788 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | SELF-ONLY (enforced — reference impl, confirm only) |
| 791 | `args.programId` | `if (!canRead(auth, args.programId)) {` | SELF-ONLY (enforced — reference impl, confirm only) |
| 792 | `args.programId` | `return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read context h` | SELF-ONLY (enforced — reference impl, confirm only) |
| 796 | `args.programId` | `const historyRef = db.collection(`tenants/${auth.userId}/sessions/_meta/program_state/${args.program` | SELF-ONLY (enforced — reference impl, confirm only) |
| 806 | `args.programId` | `programId: args.programId,` | SELF-ONLY (enforced — reference impl, confirm only) |
| 809 | `args.programId` | `message: `Retrieved ${entries.length} context history entries for "${args.programId}".`,` | SELF-ONLY (enforced — reference impl, confirm only) |

### `modules/relay.ts` — 41 site(s)

Primitive present in file: **verifySource, isAdmin**. Default disposition: **SELF-ONLY (+broadcast "all" exemption — D4 unresolved)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 131 | `args.target` | `if (args.message_type === "STATUS" && args.target !== "user" && args.target !== "admin") {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 131 | `args.target` | `if (args.message_type === "STATUS" && args.target !== "user" && args.target !== "admin") {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 133 | `args.source` | ``[Comms Pattern] ${args.source}→${args.target} STATUS via relay. ` +` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 133 | `args.target` | ``[Comms Pattern] ${args.source}→${args.target} STATUS via relay. ` +` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 139 | `args.source` | `const verifiedSource = verifySource(args.source, auth, "mcp");` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 172 | `args.target` | `let targets = await resolveTargetsAsync(auth.userId, args.target);` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 178 | `args.target` | `const rawTarget: string = args.target;` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 231 | `args.sessionId` | `sessionId: args.sessionId \|\| null,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 260 | `args.target` | `multicastSource: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 276 | `args.target` | `title: `[${verifiedSource}→${args.target}] ${args.message_type}`,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 280 | `args.target` | `target: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 302 | `args.source` | `wakeTarget({ userId: auth.userId, target: tenantOwnerCapture, waitForAlive: false, callerSource: arg` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 321 | `args.target` | `target: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 344 | `args.target` | `message: `Multicast sent to ${targets.length} recipients (${args.target}). ID: "${multicastId}"`,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 351 | `args.target` | `target: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 363 | `args.target` | `args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 366 | `args.sessionId` | `args.sessionId` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 385 | `args.target` | `target: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 398 | `args.target` | `title: `[${verifiedSource}→${args.target}] ${args.message_type}`,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 402 | `args.target` | `target: args.target,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 472 | `args.target` | `const requestedTarget = args.target \|\| args.sessionId;` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 472 | `args.sessionId` | `const requestedTarget = args.target \|\| args.sessionId;` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 615 | `args.source` | `const source = isPrivileged && args.source ? args.source : auth.programId;` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 615 | `args.source` | `const source = isPrivileged && args.source ? args.source : auth.programId;` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 624 | `args.target` | `if (args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 625 | `args.target` | `query = query.where("target", "==", args.target);` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 723 | `args.source` | `if (!args.threadId && !args.source && !args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 723 | `args.target` | `if (!args.threadId && !args.source && !args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 737 | `args.source` | `if (args.source && args.source !== self) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 737 | `args.source` | `if (args.source && args.source !== self) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 743 | `args.target` | `if (args.target && args.target !== self && args.target !== "all") {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 743 | `args.target` | `if (args.target && args.target !== self && args.target !== "all") {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 743 | `args.target` | `if (args.target && args.target !== self && args.target !== "all") {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 778 | `args.source` | `if (privileged \|\| args.source \|\| args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 778 | `args.target` | `if (privileged \|\| args.source \|\| args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 782 | `args.source` | `if (args.source) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 783 | `args.source` | `q = q.where("source", "==", args.source);` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 785 | `args.target` | `if (args.target) {` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 786 | `args.target` | `q = q.where("target", "==", args.target);` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 851 | `args.source` | `source: args.source ?? null,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |
| 852 | `args.target` | `target: args.target ?? null,` | SELF-ONLY (+broadcast "all" exemption — D4 unresolved) |

### `modules/dispatch/dispatchHandler.ts` — 36 site(s)

Primitive present in file: **verifySource**. Default disposition: **FOREIGN-WRITE (orchestrator, by capability not name — R7)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 231 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 269 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 293 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 361 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 380 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 399 | `args.target` | `logDirective(auth.userId, txResult.directiveId!, verifiedSource, args.target, directiveMessage.subst` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 416 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 710 | `args.source` | `const verifiedSource = verifySource(args.source, auth, "mcp");` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 713 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 713 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 713 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 714 | `args.target` | `const isKnown = await isProgramRegistered(auth.userId, args.target);` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 718 | `args.target` | `error: `Unknown target program: "${args.target}". Use a valid program ID.`,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 734 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 773 | `args.target` | `const targetPaused = await isProgramPaused(auth.userId, args.target);` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 776 | `args.target` | ``[target_paused] Target program "${args.target}" is paused. Task will be created but target won't re` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 781 | `args.target` | `const targetQuarantined = await isProgramQuarantined(auth.userId, args.target);` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 784 | `args.target` | ``[target_quarantined] Target program "${args.target}" is quarantined. Dispatch blocked. Use dispatch` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 824 | `args.target` | `queryTargetState(auth.userId, args.target),` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 840 | `args.target` | `message: `Dispatch obligation stored for ${args.target}, but runtime preflight exceeded the caller b` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 864 | `args.target` | `message: `Dispatch obligation stored for ${args.target}, but runtime preflight failed after persiste` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 887 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 905 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 926 | `args.target` | `message: `Dispatch obligation stored for ${args.target}, but wake exceeded the caller boundary. Trac` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 958 | `args.target` | `message: `Dispatch obligation stored for ${args.target}, but wake failed after persistence: ${runtim` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1002 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1024 | `args.target` | `currentTarget: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1059 | `args.target` | `args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1110 | `args.target` | `const spawnConfig = SPAWNABLE_PROGRAMS.get(args.target);` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1153 | `args.target` | `programId: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1160 | `args.target` | `? `Task created but target "${args.target}" is QUARANTINED. Dispatch blocked. Use dispatch_unquarant` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1162 | `args.target` | `? `Task created but target "${args.target}" is PAUSED. Task will remain queued until target is resum` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1164 | `args.target` | `? `Dispatched to ${args.target} — uptake confirmed by ${uptakeVia \|\| "claim"}${claimedBy ? ` from ` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1166 | `args.target` | `? `Dispatch obligation stored for ${args.target}; uptake wait skipped by caller. Track pendingHandle` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1167 | `args.target` | `: `Dispatch obligation stored for ${args.target} but uptake NOT confirmed within ${args.uptakeTimeou` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |
| 1187 | `args.target` | `target: args.target,` | FOREIGN-WRITE (orchestrator, by capability not name — R7) |

### `modules/pulse.ts` — 21 site(s)

Primitive present in file: **isAdmin, hasCapability (both broken — §0.2 shape)**. Default disposition: **MIXED — see per-handler override**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 74 | `args.sessionId` | `const sessionId = args.sessionId \|\| `session_${Date.now()}`;` | SELF-ONLY (createSessionHandler) |
| 103 | `args.programId` | `const programId = args.programId \|\| sessionId.split(".")[0];` | SELF-ONLY (createSessionHandler) |
| 164 | `args.sessionId` | `const sessionId = args.sessionId \|\| `session_${Date.now()}`;` | SELF-ONLY (updateSessionHandler — R6-adjacent, pulse_update_session) |
| 649 | `args.programId` | `if (args.programId) {` | FOREIGN-READ (getFleetHealthHandler — named in plan) |
| 650 | `args.programId` | `query = query.where("programId", "==", args.programId);` | FOREIGN-READ (getFleetHealthHandler — named in plan) |
| 727 | `args.sessionId` | `if (args.sessionId) {` | UNASSIGNED IN PLAN PROSE — getContextUtilizationHandler reads args.sessionId with NO gate at all (no self-check, no capability check); default SELF-ONLY per §5 but this handler structurally needs cross-session visibility like get_fleet_health. ESCALATED to BASHER — see report. |
| 729 | `args.sessionId` | `const sessionDoc = await db.doc(`tenants/${auth.userId}/sessions/${args.sessionId}`).get();` | UNASSIGNED IN PLAN PROSE — getContextUtilizationHandler reads args.sessionId with NO gate at all (no self-check, no capability check); default SELF-ONLY per §5 but this handler structurally needs cross-session visibility like get_fleet_health. ESCALATED to BASHER — see report. |
| 754 | `args.sessionId` | `sessionId: args.sessionId,` | UNASSIGNED IN PLAN PROSE — getContextUtilizationHandler reads args.sessionId with NO gate at all (no self-check, no capability check); default SELF-ONLY per §5 but this handler structurally needs cross-session visibility like get_fleet_health. ESCALATED to BASHER — see report. |
| 827 | `args.programId` | `const programExists = await isProgramRegistered(auth.userId, args.programId);` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 829 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 832 | `args.programId` | `const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 854 | `args.programId` | `program_id: args.programId,` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 869 | `args.programId` | `programId: args.programId,` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 872 | `args.programId` | `message: `Program "${args.programId}" paused. Task intake suspended.`,` | FOREIGN-WRITE (pauseProgramHandler — named in plan) |
| 890 | `args.programId` | `const programExists = await isProgramRegistered(auth.userId, args.programId);` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 892 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 895 | `args.programId` | `const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 902 | `args.programId` | `throw new Error(`Program "${args.programId}" is not paused.`);` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 918 | `args.programId` | `program_id: args.programId,` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 932 | `args.programId` | `programId: args.programId,` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |
| 934 | `args.programId` | `message: `Program "${args.programId}" resumed. Task intake re-enabled.`,` | FOREIGN-WRITE (resumeProgramHandler — named in plan) |

### `modules/dispatch/tasks.ts` — 14 site(s)

Primitive present in file: **verifySource**. Default disposition: **FOREIGN-READ (R7)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 154 | `args.target` | `if (args.target && args.type !== "sprint" && args.type !== "sprint-story") {` | FOREIGN-READ (R7) |
| 156 | `args.target` | `query = query.where("target", "==", args.target);` | FOREIGN-READ (R7) |
| 157 | `args.target` | `} else if (!args.target && auth.programId !== "legacy" && auth.programId !== "mobile"` | FOREIGN-READ (R7) |
| 370 | `args.source` | `const verifiedSource = verifySource(args.source, auth, "mcp");` | FOREIGN-READ (R7) |
| 373 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-READ (R7) |
| 373 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-READ (R7) |
| 373 | `args.target` | `if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {` | FOREIGN-READ (R7) |
| 374 | `args.target` | `const isKnown = await isProgramRegistered(auth.userId, args.target);` | FOREIGN-READ (R7) |
| 376 | `args.target` | `return jsonResult({ success: false, error: `Unknown target program: "${args.target}". Use a valid pr` | FOREIGN-READ (R7) |
| 407 | `args.target` | `target: args.target,` | FOREIGN-READ (R7) |
| 461 | `args.target` | `target: args.target,` | FOREIGN-READ (R7) |
| 481 | `args.target` | `target: args.target,` | FOREIGN-READ (R7) |
| 511 | `args.target` | `const targetInfo = await queryTargetState(auth.userId, args.target);` | FOREIGN-READ (R7) |
| 518 | `args.target` | `enriched.warning = `Target "${args.target}" is ${targetInfo.targetState} (heartbeat: ${targetInfo.he` | FOREIGN-READ (R7) |

### `modules/gsp.ts` — 9 site(s)

Primitive present in file: **verifySource (present, unused in bootstrap)**. Default disposition: **FOREIGN-READ, memory-stripped (R3/R5) — see per-handler override**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 430 | `args.source` | `const verifiedSource = verifySource(args.source, auth, "mcp");` | SELF-ONLY (gspWriteHandler — the ONE call site of verifySource in this file; correctly scoped to own writes) |
| 623 | `args.agentId` | `agentId: args.agentId,` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — same bootstrap read (agentId echoed in response/log, not itself a second store query) |
| 668 | `args.agentId` | `const programDoc = await db.doc(`tenants/${auth.userId}/programs/${args.agentId}`).get();` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — plan-cited: identity read (R3) |
| 680 | `args.agentId` | `: getDefaultCapabilities(args.agentId as ValidProgramId);` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — plan-cited: capabilities read (R3) |
| 683 | `args.agentId` | `console.warn(`[GSP Bootstrap] Failed to load identity for ${args.agentId}:`, err);` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — same bootstrap read (agentId echoed in response/log, not itself a second store query) |
| 928 | `args.agentId` | `.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.agentId}`)` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — plan-cited: program_state read (R3, R5 memory) |
| 987 | `args.agentId` | `.where("target", "in", [args.agentId, "all"])` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — plan-cited: pendingTasks read (R3) |
| 1016 | `args.agentId` | `.where("target", "==", args.agentId)` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — plan-cited: unreadMessages read (R3) |
| 1069 | `args.agentId` | `message: `Bootstrap payload generated for ${args.agentId}`,` | FOREIGN-READ, memory-stripped (gspBootstrapHandler, UNGATED — verifySource imported but never called here) — same bootstrap read (agentId echoed in response/log, not itself a second store query) |

### `modules/programRegistry.ts` — 6 site(s)

Primitive present in file: **isAdmin**. Default disposition: **FOREIGN-WRITE (registration mutates fleet routing)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 391 | `args.programId` | `const ref = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);` | FOREIGN-WRITE (registration mutates fleet routing) |
| 395 | `args.programId` | `return jsonResult({ success: false, error: `Program not found: "${args.programId}"` });` | FOREIGN-WRITE (registration mutates fleet routing) |
| 400 | `args.programId` | `const isSelf = auth.programId === args.programId;` | FOREIGN-WRITE (registration mutates fleet routing) |
| 417 | `args.programId` | `invalidateCache(auth.userId, args.programId);` | FOREIGN-WRITE (registration mutates fleet routing) |
| 427 | `args.programId` | `programId: args.programId,` | FOREIGN-WRITE (registration mutates fleet routing) |
| 429 | `args.programId` | `message: `Program "${args.programId}" updated.`,` | FOREIGN-WRITE (registration mutates fleet routing) |

### `modules/metrics.ts` — 3 site(s)

Primitive present in file: **isAdmin, hasCapability**. Default disposition: **FOREIGN-READ**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 683 | `args.programId` | `if (args.programId) {` | FOREIGN-READ |
| 684 | `args.programId` | `tasksQuery = tasksQuery.where("target", "==", args.programId);` | FOREIGN-READ |
| 829 | `args.programId` | `programs: args.programId ? results : results,` | FOREIGN-READ |

### `modules/audit.ts` — 2 site(s)

Primitive present in file: **isAdmin, hasCapability**. Default disposition: **FOREIGN-READ**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 44 | `args.programId` | `if (args.programId) {` | FOREIGN-READ |
| 45 | `args.programId` | `query = query.where("programId", "==", args.programId);` | FOREIGN-READ |

### `modules/trace.ts` — 2 site(s)

Primitive present in file: **isAdmin**. Default disposition: **FOREIGN-READ**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 214 | `args.programId` | `if (args.programId) {` | FOREIGN-READ |
| 215 | `args.programId` | `query = query.where("programId", "==", args.programId);` | FOREIGN-READ |

### `modules/dispatch/claims.ts` — 10 site(s)

Primitive present in file: **isAdmin**. Default disposition: **SELF-ONLY (claim is a lease on own work)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 76 | `args.sessionId` | `const sameSession = (data.sessionId ?? null) === (args.sessionId ?? null);` | SELF-ONLY (claim is a lease on own work) |
| 96 | `args.sessionId` | `sessionId: args.sessionId \|\| null,` | SELF-ONLY (claim is a lease on own work) |
| 113 | `args.sessionId` | `emitClaimEvent(db, auth.userId, args.taskId, args.sessionId \|\| auth.programId, "contention");` | SELF-ONLY (claim is a lease on own work) |
| 128 | `args.sessionId` | `session_id: args.sessionId \|\| undefined,` | SELF-ONLY (claim is a lease on own work) |
| 136 | `args.sessionId` | `sessionId: args.sessionId,` | SELF-ONLY (claim is a lease on own work) |
| 145 | `args.sessionId` | `emitClaimEvent(db, auth.userId, args.taskId, args.sessionId \|\| auth.programId, "claimed");` | SELF-ONLY (claim is a lease on own work) |
| 292 | `args.sessionId` | `const sameSession = (data.sessionId ?? null) === (args.sessionId ?? null);` | SELF-ONLY (claim is a lease on own work) |
| 311 | `args.sessionId` | `sessionId: args.sessionId \|\| null,` | SELF-ONLY (claim is a lease on own work) |
| 338 | `args.sessionId` | `session_id: args.sessionId \|\| undefined,` | SELF-ONLY (claim is a lease on own work) |
| 344 | `args.sessionId` | `sessionId: args.sessionId,` | SELF-ONLY (claim is a lease on own work) |

### `modules/keys.ts` — 1 site(s)

Primitive present in file: **credentialPrincipal, isKeyAdmin**. Default disposition: **DONE (PR-1, shipped & proven on cachebash-mcp-00191-z4z)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 45 | `args.programId (destructured)` | `const { programId, label } = args;` | DONE (PR-1, shipped & proven on cachebash-mcp-00191-z4z) |

### `modules/dispatch/interventions.ts` — 14 site(s)

Primitive present in file: **none**. Default disposition: **FOREIGN-WRITE (admin capability — largest unprotected surface)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 507 | `args.programId` | `const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 510 | `args.programId` | `const isKnown = await isProgramRegistered(auth.userId, args.programId);` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 512 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 537 | `args.programId` | `program_id: args.programId,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 551 | `args.programId` | `programId: args.programId,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 555 | `args.programId` | `? `Program "${args.programId}" was already quarantined. Reason updated.`` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 556 | `args.programId` | `: `Program "${args.programId}" quarantined. All dispatches blocked until unquarantined.`,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 571 | `args.programId` | `const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 574 | `args.programId` | `const isKnown = await isProgramRegistered(auth.userId, args.programId);` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 576 | `args.programId` | `return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 584 | `args.programId` | `return { error: `Program "${args.programId}" is not quarantined.` };` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 606 | `args.programId` | `program_id: args.programId,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 619 | `args.programId` | `programId: args.programId,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |
| 621 | `args.programId` | `message: `Program "${args.programId}" unquarantined. Dispatch enabled.`,` | FOREIGN-WRITE (admin capability — largest unprotected surface) |

### `modules/schedule.ts` — 9 site(s)

Primitive present in file: **none**. Default disposition: **FOREIGN-WRITE (writes work into target's future)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 105 | `args.target` | `target: args.target,` | FOREIGN-WRITE (writes work into target's future) |
| 123 | `args.target` | `message: `Schedule "${args.name}" created for target "${args.target}" with cron "${args.cron}".`,` | FOREIGN-WRITE (writes work into target's future) |
| 159 | `args.target` | `if (args.target !== undefined && data.target !== args.target) continue;` | FOREIGN-WRITE (writes work into target's future) |
| 159 | `args.target` | `if (args.target !== undefined && data.target !== args.target) continue;` | FOREIGN-WRITE (writes work into target's future) |
| 173 | `args.target` | `const filters = { target: args.target \|\| null, enabled: args.enabled ?? null };` | FOREIGN-WRITE (writes work into target's future) |
| 176 | `args.target` | `if (args.target) {` | FOREIGN-WRITE (writes work into target's future) |
| 177 | `args.target` | `ref = ref.where("target", "==", args.target);` | FOREIGN-WRITE (writes work into target's future) |
| 269 | `args.target` | `if (args.target !== undefined) updates.target = args.target;` | FOREIGN-WRITE (writes work into target's future) |
| 269 | `args.target` | `if (args.target !== undefined) updates.target = args.target;` | FOREIGN-WRITE (writes work into target's future) |

### `modules/rate-limits.ts` — 4 site(s)

Primitive present in file: **none**. Default disposition: **FOREIGN-READ**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 76 | `args.sessionId` | `sessionId: args.sessionId,` | FOREIGN-READ |
| 90 | `args.sessionId` | `message: `Rate limit event logged for session ${args.sessionId}.`,` | FOREIGN-READ |
| 105 | `args.sessionId` | `if (args.sessionId) {` | FOREIGN-READ |
| 106 | `args.sessionId` | `query = query.where("sessionId", "==", args.sessionId);` | FOREIGN-READ |

### `modules/ack-compliance.ts` — 3 site(s)

Primitive present in file: **none**. Default disposition: **FOREIGN-READ**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 112 | `args.programId` | `if (args.programId) {` | FOREIGN-READ |
| 113 | `args.programId` | `query = query.where("source", "==", args.programId);` | FOREIGN-READ |
| 146 | `args.programId` | `programId: args.programId \|\| "all",` | FOREIGN-READ |

### `modules/signal.ts` — 1 site(s)

Primitive present in file: **none**. Default disposition: **SELF-ONLY**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 187 | `args.sessionId` | `sessionId: args.sessionId \|\| null,` | SELF-ONLY |

### `modules/sprint.ts` — 1 site(s)

Primitive present in file: **none**. Default disposition: **SELF-ONLY**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 181 | `args.sessionId` | `sessionId: args.sessionId \|\| null,` | SELF-ONLY |

### `modules/wake/onDemandWake.ts` — 1 site(s)

Primitive present in file: **none**. Default disposition: **FOREIGN-WRITE (waking another program — destructured, invisible to args.-only grep)**.

| Line | Identifier read | Snippet | Disposition |
|---|---|---|---|
| 208 | `req.target (destructured)` | `const { userId, target, waitForAlive = true, callerSource, taskId } = req;` | FOREIGN-WRITE (waking another program — destructured, invisible to args.-only grep) |
### `transport/rest.ts` — 6 site(s) + the admin gate (bypasses handlers — §0.1 does not reach these)

These run their own Firestore queries directly instead of delegating to an MCP handler, so a handler-level PR-3/4/5
fix will **not** reach them; they are separately enumerated per the plan's §2.3 and §0.2.

**Line-number note:** the sweep was run against the exact same commit the plan cites (`adaf9a5` — this worktree's
`HEAD`), and the site *count* (6) and the routes they belong to match the plan exactly, but the precise line
numbers below (verified by direct `grep -n` against this checkout) differ by 1-4 lines from the plan's own
citations (`:128-130`, `:324`/`:330`, `:423-424`, `:450`, `:854`, `:938`). Route-for-route this is the same six
sites, just cited a few lines off in the plan's prose — not a discrepancy in the enumeration or the count, so not
escalated as a finding, just disclosed for anyone diffing against the plan's line numbers directly.

| Line (verified) | Read | Route / snippet | Disposition |
|---|---|---|---|
| 129-130 | `auth.capabilities.includes("*")` + `auth.programId` | `requireAdmin()`: `if (auth.capabilities.includes("*") \|\| (ADMIN_READERS as readonly string[]).includes(auth.programId)) {` | **REWRITE** (§0.2 — gates R1; explicitly assigned to PR-4, **not touched by PR-2**) |
| 325 | `query.target` | `GET /v1/tasks/stats`: `const target = query.target as string \| undefined;` then `if (target) q = q.where("target", "==", target);` — route is already behind `requireAdmin()` (the broken §0.2 gate, line 321) | FOREIGN-READ — direct cross-program task read |
| 424 | `query.sessionId` | `GET /v1/messages/unread`: `if (query.sessionId) {` | SELF-ONLY |
| 425 | `query.sessionId` | `GET /v1/messages/unread`: `q = q.where("target", "==", query.sessionId);` — no gate of any kind on this route; any caller can pass any `sessionId` | SELF-ONLY |
| 451 | `query.sessionId` | `GET /v1/messages`: `callTool(auth, req, "get_messages", { sessionId: query.sessionId \|\| "rest", ...query })` | SELF-ONLY — reaches R6's drain via REST |
| 857 | `query.sessionId` | `GET /v1/interrupts/peek` (legacy redirect): `callTool(auth, req, "get_messages", { sessionId: query.sessionId \|\| "peek", markAsRead: false })` | SELF-ONLY |
| 941 | `body.programId` | `POST /admin/reset-program-cache`: `const programId = body.programId as string \| undefined;` — route is already behind an inline `auth.capabilities.includes("*")` check (line 936, same broken wildcard shape as §0.2, not the `requireAdmin()` helper) | FOREIGN-WRITE |

Both `GET /v1/messages/unread` sites (424, 425) currently have **no gate at all** — not even the broken §0.2
wildcard/programId one. Disposition SELF-ONLY per the plan's default; not changed here (PR-2 makes no
authorization decisions).

### `iso/isoServer.ts` — 0 sites

Confirmed by reading the file, not by trusting a zero-hit grep (§0.3's own warning about a "clean zero from a new
sweep"). `iso/isoServer.ts` maps 19 tool names onto the **same handler functions** the MCP layer calls
(`ISO_TOOL_HANDLERS`, `:30-49`), then calls `handler(authContext, args)` at `:138` — it reads no identifier from
its own arguments. Its own gate, `checkToolCapability(name, authContext.capabilities)` (`:102`), is
wildcard-satisfiable and adds no protection of its own; a fix that lands inside the handler (§0.1's architectural
instruction: "gate inside the handler, never in a transport wrapper") covers this transport automatically. It
exposes `dispatch_get_tasks`, `relay_get_messages`, `keys_list_keys`, and `pulse_update_session` — every hole in
the PDR is reachable here today, same as the plan states.
