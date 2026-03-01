/**
 * Rate limit configuration — Tier-based sliding window.
 *
 * Tiers keyed by API key's rateLimitTier field in Firestore.
 * Default tier for keys without the field: "free".
 * In-memory sliding window counters (Cloud Run single instance).
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitTierConfig {
  name: string;
  requestsPerMinute: number;
  burstAllowance: number;
  retryAfterStrategy: "fixed" | "dynamic";
  fixedRetryAfterSeconds: number;
}

/** Tier definitions per ALAN schema review */
export const TIERS: Record<string, RateLimitTierConfig> = {
  internal: {
    name: "internal",
    requestsPerMinute: 600,
    burstAllowance: 50,
    retryAfterStrategy: "dynamic",
    fixedRetryAfterSeconds: 5,
  },
  free: {
    name: "free",
    requestsPerMinute: 60,
    burstAllowance: 10,
    retryAfterStrategy: "fixed",
    fixedRetryAfterSeconds: 30,
  },
  pro: {
    name: "pro",
    requestsPerMinute: 300,
    burstAllowance: 30,
    retryAfterStrategy: "dynamic",
    fixedRetryAfterSeconds: 10,
  },
};

export const DEFAULT_TIER = "free";

/** Sliding window size */
export const WINDOW_MS = 60_000;

/** Per-key global limit (all tools combined) — legacy, used as fallback */
export const KEY_GLOBAL: RateLimitConfig = { limit: 60, windowMs: 60_000 };

/** Per-key tool-specific limits (override global for write-heavy tools) */
export const TOOL_LIMITS: Record<string, RateLimitConfig> = {
  create_task: { limit: 10, windowMs: 60_000 },
  send_message: { limit: 30, windowMs: 60_000 },
  update_program_state: { limit: 10, windowMs: 60_000 },
};

/** Per-tenant aggregate limit (all keys combined) */
export const TENANT_AGGREGATE: RateLimitConfig = { limit: 1200, windowMs: 60_000 };

/** Auth attempt limit per IP */
export const AUTH_ATTEMPT: RateLimitConfig = { limit: 60, windowMs: 60_000 };

/** Firestore counter TTL — docs auto-expire after this */
export const COUNTER_TTL_MS = 5 * 60 * 1000; // 5 minutes
