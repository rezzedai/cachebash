/**
 * Rate limiter — Sliding window, tier-based enforcement.
 *
 * Architecture:
 * - In-memory sliding window counters (Cloud Run single instance)
 * - Tier-aware: internal (600/min), free (60/min), pro (300/min)
 * - Burst allowance: requests above limit before hard 429
 * - Dynamic Retry-After with jitter for internal/pro; fixed for free
 * - Fire-and-forget Firestore persistence for audit trail
 * - Fire-and-forget log_rate_limit_event on throttle
 *
 * Firestore path: tenants/{uid}/usage/rate/{scope}/{windowKey}
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import {
  TIERS,
  DEFAULT_TIER,
  WINDOW_MS,
  TOOL_LIMITS,
  TENANT_AGGREGATE,
  AUTH_ATTEMPT,
  COUNTER_TTL_MS,
} from "../config/rateLimits.js";
import type { RateLimitTierConfig } from "../config/rateLimits.js";

// --- Sliding window storage ---
// Each key maps to an array of request timestamps within the window

const windows = new Map<string, number[]>();

function slidingWindowCount(cacheKey: string, now: number): number {
  const cutoff = now - WINDOW_MS;
  let timestamps = windows.get(cacheKey);
  if (!timestamps) return 0;
  // Prune expired entries
  const pruned = timestamps.filter((t) => t > cutoff);
  if (pruned.length !== timestamps.length) {
    windows.set(cacheKey, pruned);
  }
  return pruned.length;
}

function slidingWindowAdd(cacheKey: string, now: number): void {
  let timestamps = windows.get(cacheKey);
  if (!timestamps) {
    timestamps = [];
    windows.set(cacheKey, timestamps);
  }
  timestamps.push(now);
}

function slidingWindowResetAt(now: number): Date {
  // Next window boundary: 1 minute from now
  return new Date(now + WINDOW_MS);
}

function oldestTimestamp(cacheKey: string, now: number): number {
  const cutoff = now - WINDOW_MS;
  const timestamps = windows.get(cacheKey);
  if (!timestamps || timestamps.length === 0) return now;
  const oldest = timestamps.find((t) => t > cutoff);
  return oldest || now;
}

// --- Retry-After calculation ---

function computeRetryAfter(tier: RateLimitTierConfig, cacheKey: string, now: number): number {
  if (tier.retryAfterStrategy === "fixed") {
    return tier.fixedRetryAfterSeconds;
  }
  // Dynamic: time until oldest request in window expires, plus jitter
  const oldest = oldestTimestamp(cacheKey, now);
  const baseDelay = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
  const jitter = Math.floor(Math.random() * Math.ceil(baseDelay * 0.5));
  return baseDelay + jitter;
}

// --- Firestore persistence (fire-and-forget) ---

function getWindowKey(): string {
  return `min-${new Date().toISOString().substring(0, 16)}`;
}

function persistCounter(userId: string, scope: string): void {
  try {
    const db = getFirestore();
    const windowKey = getWindowKey();
    const ref = db.doc(`tenants/${userId}/usage/rate/${scope}/${windowKey}`);
    const expiresAt = new Date(Date.now() + COUNTER_TTL_MS);
    ref.set(
      { count: FieldValue.increment(1), expiresAt, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {});
  } catch {
    // Fire-and-forget
  }
}

// --- Log rate limit event (fire-and-forget) ---

function logThrottleEvent(userId: string, programId: string, tier: string, scope: string, retryAfter: number): void {
  try {
    const db = getFirestore();
    const ttl = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    db.collection(`tenants/${userId}/rate_limit_events`).add({
      timestamp: serverTimestamp(),
      sessionId: "server-enforced",
      programId,
      modelTier: tier,
      endpoint: scope,
      backoffMs: retryAfter * 1000,
      cascaded: false,
      ttl,
    }).catch(() => {});
  } catch {
    // Fire-and-forget
  }
}

// --- Rate limit result ---

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
  /** Which limit was hit: "key" | "tenant" | "tool:{name}" | tier name */
  scope?: string;
  tier?: string;
}

// --- Per-request rate limit headers storage ---

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
 * Enforce rate limits for a request using sliding window + tier-based limits.
 * Checks in order: per-tool → per-key (tier-aware) → per-tenant aggregate.
 * First failure short-circuits.
 */
export function enforceRateLimit(
  userId: string,
  keyHash: string,
  tool: string,
  rateLimitTier?: string,
  programId?: string,
): RateLimitResult {
  const now = Date.now();
  const resetAt = slidingWindowResetAt(now);
  const tier = TIERS[rateLimitTier || DEFAULT_TIER] || TIERS[DEFAULT_TIER];
  const effectiveLimit = tier.requestsPerMinute;
  const hardLimit = effectiveLimit + tier.burstAllowance;

  // 1. Per-key tool-specific limit (unchanged — still fixed per-tool caps)
  const toolConfig = TOOL_LIMITS[tool];
  if (toolConfig) {
    const toolKey = `tool:${tool}:${keyHash}`;
    const toolCount = slidingWindowCount(toolKey, now);
    if (toolCount >= toolConfig.limit) {
      const retryAfter = computeRetryAfter(tier, toolKey, now);
      logThrottleEvent(userId, programId || "unknown", tier.name, `tool:${tool}`, retryAfter);
      return {
        allowed: false,
        limit: toolConfig.limit,
        remaining: 0,
        resetAt,
        retryAfter,
        scope: `tool:${tool}`,
        tier: tier.name,
      };
    }
    slidingWindowAdd(toolKey, now);
    persistCounter(userId, toolKey);
  }

  // 2. Per-key global limit (tier-aware with burst)
  const keyKey = `key:${keyHash}`;
  const keyCount = slidingWindowCount(keyKey, now);
  if (keyCount >= hardLimit) {
    const retryAfter = computeRetryAfter(tier, keyKey, now);
    logThrottleEvent(userId, programId || "unknown", tier.name, "key", retryAfter);
    return {
      allowed: false,
      limit: effectiveLimit,
      remaining: 0,
      resetAt,
      retryAfter,
      scope: "key",
      tier: tier.name,
    };
  }
  slidingWindowAdd(keyKey, now);
  persistCounter(userId, keyHash);

  // 3. Per-tenant aggregate limit
  const tenantKey = `tenant:${userId}`;
  const tenantCount = slidingWindowCount(tenantKey, now);
  if (tenantCount >= TENANT_AGGREGATE.limit) {
    const retryAfter = computeRetryAfter(tier, tenantKey, now);
    logThrottleEvent(userId, programId || "unknown", tier.name, "tenant", retryAfter);
    return {
      allowed: false,
      limit: TENANT_AGGREGATE.limit,
      remaining: 0,
      resetAt,
      retryAfter,
      scope: "tenant",
      tier: tier.name,
    };
  }
  slidingWindowAdd(tenantKey, now);
  persistCounter(userId, "_tenant");

  // All checks passed — remaining based on tier limit (not burst)
  const keyRemaining = effectiveLimit - keyCount - 1;
  const tenantRemaining = TENANT_AGGREGATE.limit - tenantCount - 1;
  const remaining = Math.max(0, Math.min(keyRemaining, tenantRemaining));

  return {
    allowed: true,
    limit: effectiveLimit,
    remaining,
    resetAt,
    tier: tier.name,
  };
}

// --- Auth rate limiting (per-IP, in-memory only) ---

export function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const cacheKey = `auth:${ip}`;
  const count = slidingWindowCount(cacheKey, now);
  if (count >= AUTH_ATTEMPT.limit) return false;
  slidingWindowAdd(cacheKey, now);
  return true;
}

// --- Cleanup (called every 5 min) ---

export function cleanupRateLimits(): void {
  const now = Date.now();
  const cutoff = now - WINDOW_MS * 2; // Keep 2x window for safety
  for (const [key, timestamps] of windows.entries()) {
    const pruned = timestamps.filter((t) => t > cutoff);
    if (pruned.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, pruned);
    }
  }
  // Clean stale pending headers
  pendingHeaders.clear();
}

// --- Legacy exports (backward compat) ---

/** @deprecated Use enforceRateLimit instead */
export function checkRateLimit(_userId: string, _tool: string): boolean {
  return true;
}

/** @deprecated Use enforceRateLimit instead */
export function getRateLimitResetIn(_userId: string, _tool: string): number {
  return 0;
}

/** @deprecated Use enforceRateLimit instead */
export function checkToolRateLimit(_userId: string, _tool: string, _programId: string): boolean {
  return true;
}

/** @deprecated Use enforceRateLimit instead */
export function getToolRateLimitResetIn(_userId: string, _tool: string, _programId: string): number {
  return 0;
}
