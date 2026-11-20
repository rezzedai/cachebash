import { writeKey } from "./seed";
import type { World, WorldCredential } from "./world";

/** A credential of `programId` holding exactly `capabilities`, in tenant `tenant` (default A). */
export async function mint(w: World, programId: string, label: string, capabilities: string[], tenant: "A" | "B" = "A"): Promise<WorldCredential> {
  const { key, keyHash } = await writeKey(w.tenants[tenant], programId, label, capabilities);
  return { name: "scoped", tenant, tenantUid: w.tenants[tenant], programId, capabilities, key, keyHash };
}
