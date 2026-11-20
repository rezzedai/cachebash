// Positive control for rule S2: auth.userId as an operand of an equality operator.
import type { AuthContext } from "../../../auth/authValidator";

export function s2Violation(auth: AuthContext, other: string): boolean {
  return auth.userId === other;
}
