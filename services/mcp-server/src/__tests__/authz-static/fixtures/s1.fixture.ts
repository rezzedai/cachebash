// Positive control for rule S1: reads .programId on an AuthContext outside auth/.
import type { AuthContext } from "../../../auth/authValidator";

export function s1Violation(auth: AuthContext): string {
  return auth.programId;
}
