// Positive control for rule S1 (cast form): `as any` must not hide a programId read off an auth context.
import type { AuthContext } from "../../../auth/authValidator";

export function s1AsAnyViolation(auth: AuthContext): string | undefined {
  return (auth as any).programId;
}
