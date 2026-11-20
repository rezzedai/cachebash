/**
 * Circuit Breaker Middleware — Boundary-enforced mutation ceilings (WS-3).
 *
 * SARK #881 finding 5: breaker state must be measured AT THE BOUNDARY, below
 * the agent — never self-reported by the caller (that finding was about a
 * spend breaker gated on agent-submitted cost_usd). This breaker counts
 * mutating tool calls server-side from auth context the caller cannot shape;
 * nothing here trusts an agent-submitted value.
 *
 * Ceilings are per-tenant, configurable in Firestore at
 * tenants/{org}/_meta/ceilings: { perKeyLimit, orgLimit, windowMs, paused, dispatchPaused }.
 *
 * FAIL-CLOSED: if that config is missing, malformed, or the read throws,
 * mutations are denied. Reads never enter this breaker at all (checked via
 * isMutatingTool before any Firestore access), so they're unaffected by
 * both the ceiling and any config outage — this is also what keeps the read
 * hot path free of the added Firestore round trip.
 *
 * Kill switch: config.paused denies every mutation for the tenant. Since
 * config is read fresh (no cross-request cache) on every mutating call,
 * flipping `paused` takes effect on the very next request.
 *
 * Dispatch pause (RD-5 C-3): config.dispatchPaused stops NEW work. It denies the
 * mutating dispatch_* tools that start or move work (see isDispatchFamilyMutation)
 * with code DISPATCH_PAUSED, and leaves wind-down and containment tools open
 * (DISPATCH_PAUSE_EXEMPT), so builders can finish and quarantine still works.
 * Two sprint tools that create task documents are also denied
 * (DISPATCH_PAUSE_EXTRA_DENIED), and the schedule executor reads the flag through
 * readDispatchPause and skips task schedules without advancing them.
 * Every other tool, including gsp_bootstrap (mapped to gsp.write, so the wider
 * `paused` switch denies it), state reads and relay messages, is unaffected, so
 * programs still boot while dispatch is refused. Nothing under src/ writes this
 * flag; a test enforces that.
 */

import type { AuthContext } from "../auth/authValidator.js";
import { getFirestore } from "../firebase/client.js";
import { sendAlertHandler } from "../modules/signal.js";
import { TOOL_CAPABILITIES } from "./capabilities.js";
import { resolveToolAlias } from "../tools/tool-aliases.js";

export interface CeilingConfig {
  perKeyLimit: number;
  orgLimit: number;
  windowMs: number;
  paused: boolean;
  /** Denies the mutating dispatch family only. Absent or non-true means off. */
  dispatchPaused: boolean;
}

/**
 * Conservative seed values for a tenant's ceiling doc. Exported for
 * provisioning tooling — NEVER consulted as a runtime fallback. A missing
 * doc fails closed (see loadCeilingConfig / checkCircuitBreaker), it does
 * not silently adopt these numbers.
 */
export const DEFAULT_CEILINGS: CeilingConfig = {
  perKeyLimit: 30,
  orgLimit: 150,
  windowMs: 60_000,
  paused: false,
  dispatchPaused: false,
};

export type BreakerCode =
  | "CEILING_CONFIG_UNAVAILABLE"
  | "CEILING_ORG_PAUSED"
  | "DISPATCH_PAUSED"
  | "CEILING_KEY_EXCEEDED"
  | "CEILING_ORG_EXCEEDED";

export type BreakerDecision =
  | { allowed: true }
  | { allowed: false; code: BreakerCode; message: string; retryAfterMs: number };

/**
 * Capabilities that grant a mutating operation but are NOT suffixed `.write`.
 * These must still be breaker-gated so the kill switch and fail-closed
 * invariants cover EVERY mutation. `fleet.control` gates
 * dispatch_quarantine_program / dispatch_unquarantine_program, both of which
 * write program state in a Firestore transaction. (SARK WS-3 final panel.)
 */
const NON_WRITE_MUTATING_CAPABILITIES = new Set(["fleet.control"]);

/**
 * Tools that write state but whose required capability does not reflect it, so
 * capability-based classification alone would miss them. `metrics_log_rate_limit_event`
 * is gated at `metrics.read` (read-tier access) yet appends a Firestore
 * `rate_limit_events` doc — breaker-gate it by name so the ceiling + kill switch
 * cover the write WITHOUT changing the capability required to call it.
 * (SARK WS-3 final panel.)
 */
const EXPLICITLY_MUTATING_TOOLS = new Set(["metrics_log_rate_limit_event"]);

/**
 * A tool is "mutating" when it writes state — normally a `*.write` grant, plus
 * the explicit non-`.write` mutating capabilities and the by-name write tools above.
 */
export function isMutatingTool(toolName: string): boolean {
  const canonical = resolveToolAlias(toolName);
  if (EXPLICITLY_MUTATING_TOOLS.has(canonical)) return true;
  const required = TOOL_CAPABILITIES[canonical];
  if (!required) return false;
  return required.endsWith(".write") || NON_WRITE_MUTATING_CAPABILITIES.has(required);
}

/**
 * Mutating dispatch_* tools that stay open under `dispatchPaused`: they wind down or
 * contain work. Completing and unclaiming let builders finish mid-task, abort and
 * escalate end work, telemetry records what ran, and quarantine/unquarantine are the
 * containment tools a rollback needs. A new mutating dispatch_* tool is NOT in this
 * set, so it is denied by default (fail closed) until someone places it.
 */
export const DISPATCH_PAUSE_EXEMPT: ReadonlySet<string> = new Set([
  "dispatch_complete_task",
  "dispatch_batch_complete_tasks",
  "dispatch_unclaim_task",
  "dispatch_abort_task",
  "dispatch_record_task_telemetry",
  "dispatch_escalate_task",
  "dispatch_quarantine_program",
  "dispatch_unquarantine_program",
]);

/**
 * Non-dispatch_ tools that also create task documents, so `dispatchPaused` denies them
 * too (VECTOR ruling on PR-G): sprint_create_sprint and sprint_add_story_to_sprint. Also
 * dream_activate (VECTOR, PR-G review): moving a queued dream to active starts autonomous work.
 */
export const DISPATCH_PAUSE_EXTRA_DENIED: ReadonlySet<string> = new Set([
  "sprint_create_sprint",
  "sprint_add_story_to_sprint",
  "dream_activate",
]);

/**
 * The tools denied by `dispatchPaused`: mutating tools whose canonical name starts with
 * `dispatch_`, minus DISPATCH_PAUSE_EXEMPT, plus DISPATCH_PAUSE_EXTRA_DENIED. Today that
 * is create_task, claim_task, batch_claim_tasks, dispatch, retry_task, replay_task,
 * reassign_task, approve_task, sprint_create_sprint, sprint_add_story_to_sprint, dream_activate.
 * Legacy aliases (create_task, ...) resolve to canonical first. Reads such as
 * dispatch_get_tasks stay allowed, and gsp_*, state_*, relay_* are not in it.
 */
export function isDispatchFamilyMutation(toolName: string): boolean {
  const canonical = resolveToolAlias(toolName);
  if (DISPATCH_PAUSE_EXTRA_DENIED.has(canonical)) return isMutatingTool(canonical);
  return canonical.startsWith("dispatch_") && isMutatingTool(canonical) && !DISPATCH_PAUSE_EXEMPT.has(canonical);
}

/**
 * Read-only check of the tenant's dispatchPaused flag, for callers that create tasks
 * outside a tool call (the schedule executor). "clear" when the document is missing or
 * dispatchPaused is not literally true, "paused" when it is true, "unknown" when the
 * read throws (the caller fails closed). Never writes.
 */
export async function readDispatchPause(org: string): Promise<"paused" | "clear" | "unknown"> {
  try {
    const snap = await getFirestore().doc(`tenants/${org}/_meta/ceilings`).get();
    if (!snap.exists) return "clear";
    return (snap.data() || {}).dispatchPaused === true ? "paused" : "clear";
  } catch (err) {
    console.error("[CircuitBreaker] dispatchPaused read failed:", err);
    return "unknown";
  }
}

// --- Rolling window math — pure, unit-tested independently of Firestore/state. ---

export function pruneWindow(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

export function countInWindow(timestamps: number[], now: number, windowMs: number): number {
  return pruneWindow(timestamps, now, windowMs).length;
}

// --- In-memory sliding-window counters — same single-instance architecture as
// rateLimiter.ts's `windows` map. Firestore holds ceiling CONFIG, not counts.

const keyWindows = new Map<string, number[]>();
const orgWindows = new Map<string, number[]>();

/** Prune expired entries and return the live count, without consuming a slot. */
function peekCount(store: Map<string, number[]>, cacheKey: string, now: number, windowMs: number): number {
  const pruned = pruneWindow(store.get(cacheKey) || [], now, windowMs);
  store.set(cacheKey, pruned);
  return pruned.length;
}

/** Consume one slot (call only after all ceiling checks for a request have passed). */
function consume(store: Map<string, number[]>, cacheKey: string, now: number): void {
  const arr = store.get(cacheKey) || [];
  arr.push(now);
  store.set(cacheKey, arr);
}

/** Test-only: clear all in-memory breaker state between test cases. */
export function resetCircuitBreakerState(): void {
  keyWindows.clear();
  orgWindows.clear();
}

// --- Firestore-backed ceiling config ---

async function loadCeilingConfig(org: string): Promise<CeilingConfig | null> {
  const db = getFirestore();
  const snap = await db.doc(`tenants/${org}/_meta/ceilings`).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  const perKeyLimit = Number(data.perKeyLimit);
  const orgLimit = Number(data.orgLimit);
  const windowMs = Number(data.windowMs);

  if (
    !Number.isFinite(perKeyLimit) || perKeyLimit <= 0 ||
    !Number.isFinite(orgLimit) || orgLimit <= 0 ||
    !Number.isFinite(windowMs) || windowMs <= 0
  ) {
    // Malformed config is treated as missing — fail closed, not "best effort".
    return null;
  }

  return { perKeyLimit, orgLimit, windowMs, paused: data.paused === true, dispatchPaused: data.dispatchPaused === true };
}

function emitBreakerAlert(auth: AuthContext, tool: string, code: BreakerCode, message: string): void {
  sendAlertHandler(auth, {
    message: `Circuit breaker tripped (${code}) on "${tool}": ${message}`,
    alertType: "warning",
    priority: "high",
  }).catch((err) => {
    console.error("[CircuitBreaker] Failed to emit signal alert:", err);
  });
}

/**
 * Enforce the boundary circuit breaker for one tool call. Read-only tools
 * bypass entirely (no Firestore read, always allowed). Callers are expected
 * to also write an audit record on denial via the existing gate.ts audit
 * logger, mirroring how the capability-gate denial path already works.
 */
export async function checkCircuitBreaker(auth: AuthContext, toolName: string): Promise<BreakerDecision> {
  if (!isMutatingTool(toolName)) return { allowed: true };

  const org = auth.userId;
  const now = Date.now();

  let config: CeilingConfig | null;
  try {
    config = await loadCeilingConfig(org);
  } catch (err) {
    console.error("[CircuitBreaker] Ceiling config read failed — failing closed:", err);
    config = null;
  }

  if (!config) {
    const message = `Ceiling configuration missing or unreadable for tenant "${org}"; mutations deny by default (fail-closed).`;
    emitBreakerAlert(auth, toolName, "CEILING_CONFIG_UNAVAILABLE", message);
    return { allowed: false, code: "CEILING_CONFIG_UNAVAILABLE", message, retryAfterMs: 60_000 };
  }

  if (config.paused) {
    const message = `Tenant "${org}" is paused; all mutations fail closed until unpaused.`;
    emitBreakerAlert(auth, toolName, "CEILING_ORG_PAUSED", message);
    return { allowed: false, code: "CEILING_ORG_PAUSED", message, retryAfterMs: config.windowMs };
  }

  if (config.dispatchPaused && isDispatchFamilyMutation(toolName)) {
    const message = `Dispatch is paused for tenant "${org}"; "${toolName}" is refused until dispatchPaused is cleared. Boot, state reads and messages still work.`;
    emitBreakerAlert(auth, toolName, "DISPATCH_PAUSED", message);
    return { allowed: false, code: "DISPATCH_PAUSED", message, retryAfterMs: config.windowMs };
  }

  const keyCacheKey = `key:${auth.apiKeyHash}`;
  const orgCacheKey = `org:${org}`;

  const keyCount = peekCount(keyWindows, keyCacheKey, now, config.windowMs);
  if (keyCount >= config.perKeyLimit) {
    const message = `Per-key mutation ceiling (${config.perKeyLimit} per ${config.windowMs}ms) exceeded.`;
    emitBreakerAlert(auth, toolName, "CEILING_KEY_EXCEEDED", message);
    return { allowed: false, code: "CEILING_KEY_EXCEEDED", message, retryAfterMs: config.windowMs };
  }

  const orgCount = peekCount(orgWindows, orgCacheKey, now, config.windowMs);
  if (orgCount >= config.orgLimit) {
    const message = `Org-aggregate mutation ceiling (${config.orgLimit} per ${config.windowMs}ms) exceeded.`;
    emitBreakerAlert(auth, toolName, "CEILING_ORG_EXCEEDED", message);
    return { allowed: false, code: "CEILING_ORG_EXCEEDED", message, retryAfterMs: config.windowMs };
  }

  // Both ceilings clear — consume one slot from each. Consuming only after
  // both checks pass keeps a call that trips the org ceiling from silently
  // costing the key its own budget.
  consume(keyWindows, keyCacheKey, now);
  consume(orgWindows, orgCacheKey, now);

  return { allowed: true };
}
