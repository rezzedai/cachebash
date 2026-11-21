// Positive control for rule S1: reads .programId on an AuthContext outside auth/.
import type { AuthContext } from "../../../auth/authValidator";

export function s1Violation(auth: AuthContext): string {
  // @ts-expect-error PR-N N-D4 removed the field; the S1 rule stays as a backstop and must still flag a read
  return auth.programId;
}
