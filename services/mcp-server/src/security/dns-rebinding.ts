export function validateRequestHeaders(
  host: string | undefined,
  origin: string | undefined,
  allowedOrigins?: string[]
): { valid: boolean; error?: string } {
  if (!host) return { valid: true };

  if (origin && allowedOrigins && allowedOrigins.length > 0) {
    if (!allowedOrigins.includes(origin)) {
      return { valid: false, error: `Origin ${origin} not allowed` };
    }
  }

  return { valid: true };
}
