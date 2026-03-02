/**
 * Tiered Access Constants — shared across program state + REST admin gates.
 */

/** Programs with admin-level read access to all resources */
export const ADMIN_READERS = ["admin", "legacy", "mobile", "orchestrator", "vector", "iso"] as const;

/** Programs that can read any program's state (non-admin) */
export const STATE_READERS = ["orchestrator", "vector", "iso", "auditor", "dispatcher"] as const;

/** Programs that can write any program's state (admin proxy) */
export const STATE_WRITERS = ["legacy", "mobile"] as const;
