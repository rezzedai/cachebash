interface LogContext {
  function: string;
  uid: string | null;
  action: string;
  durationMs: number;
}

export function logSuccess(ctx: LogContext): void {
  console.log(JSON.stringify({ severity: "INFO", status: "success", ...ctx }));
}

export function logError(ctx: LogContext, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ severity: "ERROR", status: "error", ...ctx, error: message }));
}
