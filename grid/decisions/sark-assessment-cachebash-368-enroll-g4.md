---
format: sark-assessment
verdict: NO-GO (narrow, fast-flippable) — /enroll must NOT be exposed
task: v1GNx4ERAf00m1Ya6eNo
gate: G-4 (code-review-before-exposure) from sark-assessment-cerebro-ungate-2026-06-16.md
pr: rezzedai/cachebash#368 (branch basher/cerebro-lite-edge)
date: 2026-06-16
reviewer: sark
---

# SARK G-4 Assessment — Cerebro `/enroll` Enrollment Endpoint

> Clean-context review of `services/mcp-server/src/modules/enrollment.ts` +
> the `/enroll` public bypass in `rest.ts`, against the 11 G-4 controls I set in
> the Stage-3 un-gate verdict. **My GO is the hard gate before /enroll is exposed.**

## Summary

**VERDICT: NO-GO** — but narrow and fast to flip. The endpoint **logic** is close to
correct and implements most controls faithfully. The blocker is that **CI is red and the
test suite does not even compile**, so the 11 controls are **asserted, not proven**. G-4 is
explicitly a "controls are verified, not claimed" gate; an un-runnable test suite fails it
by definition. Two real logic gaps (TTL non-enforcement, capability scoping) ride along.

## Scope

Reviewed: `modules/enrollment.ts` (full), `transport/rest.ts` /enroll bypass (L905-913),
CI run 27592798165. NOT in scope here: G-1 terraform live-verify (separate gate — curl-proof
bare *.run.app 403/404 still pending); the token **issuance**/welcome-email path (not in this PR).

## Findings

### F-368-1 — BLOCKING (NO-GO): CI red; tests uncompilable; controls unverified
`src/__tests__/enrollment.test.ts:7` imports from **`vitest`**. This repo's harness is
**jest/ts-jest**. Result: `TS2307: Cannot find module 'vitest'` → **Typecheck FAIL, Build FAIL,
Test FAIL** (run 27592798165). basher's "11/11 green" was a local vitest run that CI does not
execute. Because the suite never compiles, **none of the 11 G-4 controls are verified by
automation** — the core requirement of this gate. **Fix:** rewrite the tests in jest (mirror
`portal-owner-send-message.test.ts` / `relay-owner-send.test.ts` — `jest.requireActual`,
real handler via http), all three CI jobs green.

### F-368-2 — LOW: ≤24h TTL cap (control 3) not enforced at redemption
`MAX_TTL_HOURS = 24` is declared (L18) and **never referenced**. Redemption trusts the stored
`data.expiresAt` (L105-111) and only rejects `now > expiresAt`. The ≤24h cap is therefore
enforced only at issuance (not in this PR). **Fix:** confirm the issuance path caps
`expiresAt ≤ now+24h`, or enforce it here (reject if `expiresAt - createdAt > 24h`). Remove or
use the dead constant.

### F-368-3 — LOW/MED: minted key capabilities not tier-scoped
The minted key hardcodes `capabilities: ["*"]` (L129) for **all** tiers; only `rateLimitTier`
(L130) reflects the tier. Guardrail 3 wants tier-scoped keys. Wildcard-within-tenant is
R7-bounded (userId=tenantId, programId=cerebro) so not a hub escalation, but "*" for a Trial
tenant is broader than the tier model implies. **Fix:** scope capabilities per tier, or confirm
"*" is intended for lite in DESIGN.md.

### F-368-4 — LOW: no per-token failed-attempt lockout (control 7, second half)
No per-token redeem-attempt cap in code; abuse defense rests entirely on the G-3 edge per-IP
limit (~10/min on /enroll). Acceptable **iff** G-3 is verified live at G-1. Flagging the
dependency so it isn't lost. (Single-use + no body-oracle already close the enumeration vector.)

### F-368-5 — INFO: timing not constant-time
Success path does Firestore writes; failure paths return after a single `tx.get`. The comment
(L93-94) acknowledges this. Practical enumeration is still closed (single-use consumes on first
success; invalid-vs-consumed timings are near-identical — both get-then-throw). Note only.

## What PASSED (verified in code)
- Control 2: token sha256-hashed at rest, looked up by hash, **raw wiped** (`token = ""`, L71); never stored/logged raw. ✓
- Control 4: single-use via `db.runTransaction` — get → assert pending → assert unexpired → mint → mark consumed, atomically. Concurrent double-redeem loses on the write-write conflict. ✓
- Control 6: consumed / expired / invalid / missing-token / parse-error all return **identical** `400 {error:"invalid_or_expired_enrollment"}`. No body oracle. ✓
- Control 8: response is **exactly** `{ lite_url, cb_key }` — topology-free; `lite_url` from env. ✓
- Controls 1/9: cb_ key = `crypto.randomBytes(32)` (256-bit); raw key **never logged**; only `sha256(key)` persisted for audit; token audit = first-8 + "…". ✓
- Control 11: `/enroll` is an exact-match (`url === "/enroll"`) pre-auth bypass; the `Cache-Control: public` at rest.ts:927 applies only to `/v1/openapi.json`, **not** to the key-bearing /enroll response. ✓
- Body size capped at 4096 bytes (L39); POST-only (405 otherwise). ✓

## NO-GO conditions (any holds → do not expose /enroll)
1. CI not green / tests not in the repo's jest harness (F-368-1). **← currently true.**
2. TTL ≤24h not provably enforced somewhere in the token lifecycle (F-368-2).
3. (separate gate) G-1 not live: LB+Armor not attached, or bare *.run.app reachable.

## Path to GO (fast)
Rewrite enrollment.test.ts in jest exercising the **real** handler + a real Firestore txn
(or emulator) so all 11 controls are covered; CI green; resolve F-368-2 and F-368-3. On green
CI + those two, this flips to GO quickly — the logic is sound.

## Scoring
```yaml
severity_distribution: { blocking: 1, high: 0, medium: 1, low: 3, info: 1 }
overall_risk: 0.40   # endpoint logic sound but unverified-by-CI + TTL/cap gaps
confidence: 0.80     # code read in full; live behavior + issuance path not exercised
```

*Everything is broken until proven otherwise. The tests don't run, so it isn't proven.*
*— SARK*
