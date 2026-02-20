/**
 * Rate limiter — Sliding window implementation.
 * Enforces per-user read/write limits and per-IP auth limits.
 */

// Read operations (120 req/min)
export const READ_TOOLS = new Set([
  "get_tasks",
  "get_messages",
  "list_sessions",
  "get_fleet_health",
  "query_message_history",
  "get_sent_messages",
  "list_groups",
  "get_dead_letters",
  "get_sprint",
  "get_response",
  "get_program_state",
  "get_audit",
  "get_cost_summary",
  "get_comms_metrics",
  "query_traces",
  "list_keys",
  "dream_peek",
]);

const READ_LIMIT = 120; // requests per minute
const WRITE_LIMIT = 60; // requests per minute
const AUTH_LIMIT = 10; // attempts per minute per IP
const WINDOW_MS = 60 * 1000; // 1 minute
const CLEANUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimits = new Map<string, RateLimitEntry>();

export class RateLimitError extends Error {
  resetIn: number;
  constructor(message: string, resetIn: number) {
    super(message);
    this.name = "RateLimitError";
    this.resetIn = resetIn;
  }
}

/**
 * Check if a user is within their rate limit for a specific tool.
 * @param userId - The user ID
 * @param tool - The tool name
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(userId: string, tool: string): boolean {
  const category = READ_TOOLS.has(tool) ? "read" : "write";
  const limit = category === "read" ? READ_LIMIT : WRITE_LIMIT;
  const key = `${userId}:${category}`;

  const now = Date.now();
  const entry = rateLimits.get(key) || { timestamps: [] };

  // Remove timestamps outside the window (sliding window)
  entry.timestamps = entry.timestamps.filter(ts => now - ts < WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    return false;
  }

  // Add current timestamp
  entry.timestamps.push(now);
  rateLimits.set(key, entry);

  return true;
}

/**
 * Get the number of seconds until the rate limit resets for a user/tool.
 * @param userId - The user ID
 * @param tool - The tool name
 * @returns seconds until reset (0 if not rate limited)
 */
export function getRateLimitResetIn(userId: string, tool: string): number {
  const category = READ_TOOLS.has(tool) ? "read" : "write";
  const key = `${userId}:${category}`;

  const entry = rateLimits.get(key);
  if (!entry || entry.timestamps.length === 0) return 0;

  const now = Date.now();
  const oldestTimestamp = entry.timestamps[0];
  const resetMs = oldestTimestamp + WINDOW_MS - now;

  return Math.ceil(resetMs / 1000);
}

/**
 * Check if an IP address is within the auth attempt rate limit.
 * @param ip - The IP address
 * @returns true if allowed, false if rate limited
 */
export function checkAuthRateLimit(ip: string): boolean {
  const key = `auth:${ip}`;

  const now = Date.now();
  const entry = rateLimits.get(key) || { timestamps: [] };

  // Remove timestamps outside the window (sliding window)
  entry.timestamps = entry.timestamps.filter(ts => now - ts < WINDOW_MS);

  if (entry.timestamps.length >= AUTH_LIMIT) {
    return false;
  }

  // Add current timestamp
  entry.timestamps.push(now);
  rateLimits.set(key, entry);

  return true;
}

/**
 * Clean up rate limit entries with no recent activity.
 * Called every 5 minutes to prevent memory growth.
 */
export function cleanupRateLimits(): void {
  const now = Date.now();

  for (const [key, entry] of rateLimits.entries()) {
    // Remove timestamps outside the cleanup window
    entry.timestamps = entry.timestamps.filter(ts => now - ts < CLEANUP_WINDOW_MS);

    // Delete entry if no recent timestamps
    if (entry.timestamps.length === 0) {
      rateLimits.delete(key);
    }
  }
}
