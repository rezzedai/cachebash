import { randomUUID } from "crypto";

export function generateCorrelationId(): string {
  return randomUUID();
}
