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
 * tenants/{org}/_meta/ceilings: { perKeyLimit, orgLimit, windowMs, paused }.
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
};

export type BreakerCode =
  | "CEILING_CONFIG_UNAVAILABLE"
  | "CEILING_ORG_PAUSED"
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
 * A tool is "mutating" when its required capability writes state — normally a
 * `*.write` grant, plus the explicit non-`.write` mutating capabilities above.
 */
export function isMutatingTool(toolName: string): boolean {
  const canonical = resolveToolAlias(toolName);
  const required = TOOL_CAPABILITIES[canonical];
  if (!required) return false;
  return required.endsWith(".write") || NON_WRITE_MUTATING_CAPABILITIES.has(required);
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

  return { perKeyLimit, orgLimit, windowMs, paused: data.paused === true };
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
