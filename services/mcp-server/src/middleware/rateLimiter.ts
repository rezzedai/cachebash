/**
 * Rate limiter — Fixed-window, per-key + per-tenant enforcement.
 * SPEC 2 (Hardening Sprint).
 *
 * Architecture:
 * - In-memory fixed-window counters as fast-path enforcement (0ms latency)
 * - Firestore counters for cross-instance persistence + audit trail (async writes)
 * - Counter docs have expiresAt for Firestore TTL auto-cleanup
 *
 * Firestore path: tenants/{uid}/usage/rate/{scope}/{windowKey}
 *   scope = keyHash (per-key) | "_tenant" (aggregate) | "tool:{name}:{keyHash}"
 *   windowKey = "min-YYYY-MM-DDTHH:mm"
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import {
  KEY_GLOBAL,
  TOOL_LIMITS,
  TENANT_AGGREGATE,
  AUTH_ATTEMPT,
  COUNTER_TTL_MS,
} from "../config/rateLimits.js";
import { getComplianceConfig } from "../config/compliance.js";

// --- In-memory fixed-window counters ---

interface WindowCounter {
  count: number;
  windowKey: string;
}

const counters = new Map<string, WindowCounter>();

function getWindowKey(): string {
  return `min-${new Date().toISOString().substring(0, 16)}`;
}

function getWindowResetAt(): Date {
  const reset = new Date();
  reset.setSeconds(0, 0);
  reset.setMinutes(reset.getMinutes() + 1);
  return reset;
}

function incrementCounter(cacheKey: string, limit: number): { allowed: boolean; count: number } {
  const windowKey = getWindowKey();
  const entry = counters.get(cacheKey);

  if (entry && entry.windowKey === windowKey) {
    if (entry.count >= limit) {
      return { allowed: false, count: entry.count };
    }
    entry.count++;
    return { allowed: true, count: entry.count };
  }

  // New window
  counters.set(cacheKey, { count: 1, windowKey });
  return { allowed: true, count: 1 };
}

// --- Firestore persistence (fire-and-forget) ---

function persistCounter(
  userId: string,
  scope: string,
  windowKey: string,
): void {
  try {
    const db = getFirestore();
    const ref = db.doc(`tenants/${userId}/usage/rate/${scope}/${windowKey}`);
    const expiresAt = new Date(Date.now() + COUNTER_TTL_MS);
    ref.set(
      { count: FieldValue.increment(1), expiresAt, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {});
  } catch {
    // Fire-and-forget — don't block request
  }
}

// --- Rate limit result ---

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
  /** Which limit was hit: "key" | "tenant" | "tool:{name}" */
  scope?: string;
}

// --- Per-request rate limit headers storage ---
// Keyed by MCP sessionId, set during tool handler, read after HTTP response

const pendingHeaders = new Map<string, RateLimitResult>();

export function setRateLimitResult(sessionId: string, result: RateLimitResult): void {
  pendingHeaders.set(sessionId, result);
}

export function consumeRateLimitResult(sessionId: string): RateLimitResult | undefined {
  const result = pendingHeaders.get(sessionId);
  pendingHeaders.delete(sessionId);
  return result;
}

// --- Main enforcement ---

/**
 * Check all rate limits for a request. Returns the most restrictive result.
 * Checks in order: per-tool → per-key global → per-tenant aggregate.
 * First failure short-circuits.
 *
 * W1.2.6: Uses compliance config if enabled, otherwise falls back to hardcoded limits.
 */
export function enforceRateLimit(
  userId: string,
  keyHash: string,
  tool: string,
): RateLimitResult {
  const windowKey = getWindowKey();
  const resetAt = getWindowResetAt();

  // W1.2.6: Check compliance config for tenant-level rate limits
  const complianceConfig = getComplianceConfig(userId);
  const useComplianceLimits = complianceConfig.rateLimits.enabled;

  // 1. Per-key tool-specific limit
  let toolLimit: number | undefined;
  if (useComplianceLimits && complianceConfig.rateLimits.requestsPerMinute[tool]) {
    toolLimit = complianceConfig.rateLimits.requestsPerMinute[tool];
  } else if (TOOL_LIMITS[tool]) {
    toolLimit = TOOL_LIMITS[tool].limit;
  }

  if (toolLimit) {
    const toolScope = `tool:${tool}:${keyHash}`;
    const toolResult = incrementCounter(toolScope, toolLimit);
    if (toolResult.allowed) {
      persistCounter(userId, toolScope, windowKey);
    }
    if (!toolResult.allowed) {
      const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
      return {
        allowed: false,
        limit: toolLimit,
        remaining: 0,
        resetAt,
        retryAfter,
        scope: `tool:${tool}`,
      };
    }
  }

  // 2. Per-key global limit
  const keyResult = incrementCounter(`key:${keyHash}`, KEY_GLOBAL.limit);
  if (keyResult.allowed) {
    persistCounter(userId, keyHash, windowKey);
  }
  if (!keyResult.allowed) {
    const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
    return {
      allowed: false,
      limit: KEY_GLOBAL.limit,
      remaining: 0,
      resetAt,
      retryAfter,
      scope: "key",
    };
  }

  // 3. Per-tenant aggregate limit
  const tenantResult = incrementCounter(`tenant:${userId}`, TENANT_AGGREGATE.limit);
  if (tenantResult.allowed) {
    persistCounter(userId, "_tenant", windowKey);
  }
  if (!tenantResult.allowed) {
    const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
    return {
      allowed: false,
      limit: TENANT_AGGREGATE.limit,
      remaining: 0,
      resetAt,
      retryAfter,
      scope: "tenant",
    };
  }

  // All checks passed — return the most restrictive remaining count
  const keyRemaining = KEY_GLOBAL.limit - keyResult.count;
  const tenantRemaining = TENANT_AGGREGATE.limit - tenantResult.count;
  const remaining = Math.min(keyRemaining, tenantRemaining);

  return {
    allowed: true,
    limit: KEY_GLOBAL.limit,
    remaining: Math.max(0, remaining),
    resetAt,
  };
}

// --- Auth rate limiting (per-IP, in-memory only) ---

export function checkAuthRateLimit(ip: string): boolean {
  const result = incrementCounter(`auth:${ip}`, AUTH_ATTEMPT.limit);
  return result.allowed;
}

// --- Cleanup (called every 5 min) ---

export function cleanupRateLimits(): void {
  const currentWindowKey = getWindowKey();
  for (const [key, entry] of counters.entries()) {
    if (entry.windowKey !== currentWindowKey) {
      counters.delete(key);
    }
  }
  // Clean stale pending headers
  pendingHeaders.clear();
}

// --- Legacy exports (backward compat for existing index.ts imports) ---

/** @deprecated Use enforceRateLimit instead */
export function checkRateLimit(userId: string, _tool: string): boolean {
  return true; // Replaced by enforceRateLimit
}

/** @deprecated Use enforceRateLimit instead */
export function getRateLimitResetIn(_userId: string, _tool: string): number {
  return 0;
}

/** @deprecated Use enforceRateLimit instead */
export function checkToolRateLimit(_userId: string, _tool: string, _programId: string): boolean {
  return true; // Replaced by enforceRateLimit
}

/** @deprecated Use enforceRateLimit instead */
export function getToolRateLimitResetIn(_userId: string, _tool: string, _programId: string): number {
  return 0;
}
