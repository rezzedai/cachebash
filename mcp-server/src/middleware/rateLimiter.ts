/**
 * Rate limiter — DISABLED for internal use (Flynn directive).
 * Stub functions for future productization.
 */

export function checkRateLimit(_userId: string, _tool: string): boolean {
  return true;
}

export function getRateLimitResetIn(_userId: string, _tool: string): number {
  return 0;
}

export function checkAuthRateLimit(_ip: string): boolean {
  return true;
}

export function cleanupRateLimits(): void {}
