/**
 * Rate limit configuration — SPEC 2 (Hardening Sprint).
 *
 * Fixed-window limits enforced per-key and per-tenant.
 * Firestore counters at: tenants/{uid}/usage/rate/{scope}/{windowKey}
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/** Per-key global limit (all tools combined) */
export const KEY_GLOBAL: RateLimitConfig = { limit: 60, windowMs: 60_000 };

/** Per-key tool-specific limits (override global for write-heavy tools) */
export const TOOL_LIMITS: Record<string, RateLimitConfig> = {
  create_task: { limit: 10, windowMs: 60_000 },
  send_message: { limit: 30, windowMs: 60_000 },
  update_program_state: { limit: 10, windowMs: 60_000 },
};

/** Per-tenant aggregate limit (all keys combined) */
export const TENANT_AGGREGATE: RateLimitConfig = { limit: 120, windowMs: 60_000 };

/** Auth attempt limit per IP */
export const AUTH_ATTEMPT: RateLimitConfig = { limit: 60, windowMs: 60_000 };

/** Firestore counter TTL — docs auto-expire after this */
export const COUNTER_TTL_MS = 5 * 60 * 1000; // 5 minutes
