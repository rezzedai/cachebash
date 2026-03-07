/**
 * Centralized configuration constants.
 * All hardcoded values that were previously scattered across modules.
 */

export const CONSTANTS = {
  ttl: {
    /** Claim event TTL in days (claim_events collection) */
    claimEventDays: 7,
    /** Default task TTL in seconds (24h) */
    defaultTaskSeconds: 86400,
    /** Default relay message TTL in seconds (24h) */
    relayMessageSeconds: 86400,
    /** Idempotency key TTL in milliseconds (1h) */
    idempotencyKeyMs: 3600000,
    /** Budget alert relay TTL in seconds */
    budgetAlertSeconds: 3600,
  },
  limits: {
    /** Max tasks in a single batch claim */
    batchClaimMax: 50,
    /** Max tasks in a single batch complete */
    batchCompleteMax: 50,
    /** Max request body size in bytes (64KB) */
    maxBodySizeBytes: 65536,
    /** Max relay delivery attempts before dead-lettering */
    maxDeliveryAttempts: 3,
  },
  cooldowns: {
    /** Self-recycle spawn cooldown in milliseconds (5 min) */
    spawnCooldownMs: 300000,
  },
  oauth: {
    /** DCR rate limit: max registrations per window */
    dcrLimit: 10,
    /** DCR rate limit window in milliseconds (1h) */
    dcrWindowMs: 3600000,
  },
};
