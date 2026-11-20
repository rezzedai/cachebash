/**
 * Tiered Access Constants — shared across program state + REST admin gates.
 */

/** Programs with admin-level read access to all resources */
export const ADMIN_READERS = ["admin", "legacy", "mobile", "orchestrator", "vector", "iso"] as const;
