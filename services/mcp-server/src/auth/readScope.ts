import type { AuthContext } from "./authValidator.js";
import { credentialPrincipal, hasFleetObserveCapability } from "./ownerAuthz.js";

/**
 * RD-5 PR-L (L-D1 option 1): the scope of a read that names an optional program.
 * A named program is allowed for its own principal or for a literal fleet.observe holder; the query filters to it.
 * No program means the principal's own rows, unless the credential holds literal fleet.observe (then no filter).
 * Bound to credentialPrincipal(auth); the capability only widens the foreign branch.
 */
export function resolveReadScope(auth: AuthContext, requested: string | undefined): { principal: string; allowed: boolean; filter: string | null } {
  const principal = credentialPrincipal(auth);
  const observer = hasFleetObserveCapability(auth);
  if (requested) return { principal, allowed: requested === principal || observer, filter: requested };
  return { principal, allowed: true, filter: observer ? null : principal };
}
