/**
 * RD-5 PR-E: authorizeKeySubject truth table, alternate-uid keys, and the fail-closed tenant lookup.
 */

import type { AuthContext } from "../auth/authValidator";
import { authorizeKeySubject, type TenantOf } from "../auth/authorize";
import { TenantResolutionError, resolveTenant } from "../auth/tenant-resolver";

const ALTERNATES: Record<string, string> = { "T0NWeYZI": "7viFKVtl" };
const tenantOf: TenantOf = async (uid) => ALTERNATES[uid] ?? uid;

function auth(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "7viFKVtl",
    apiKeyHash: "h",
    encryptionKey: Buffer.alloc(32),
    programId: "iso" as any,
    keyProgramId: "iso" as any,
    capabilities: ["tasks.read"],
    rateLimitTier: "free",
    ...over,
  };
}

describe("authorizeKeySubject truth table", () => {
  // caller tenant 7viFKVtl, caller program iso
  const rows: { name: string; auth: AuthContext; doc: any; expect: { allowed: boolean; via?: string; reason?: string } }[] = [
    { name: "same tenant, same program", auth: auth(), doc: { userId: "7viFKVtl", programId: "iso" }, expect: { allowed: true, via: "self" } },
    { name: "same tenant, other program, no capability", auth: auth(), doc: { userId: "7viFKVtl", programId: "vector" }, expect: { allowed: false, reason: "program" } },
    { name: "same tenant, other program, wildcard only", auth: auth({ capabilities: ["*"] }), doc: { userId: "7viFKVtl", programId: "vector" }, expect: { allowed: false, reason: "program" } },
    { name: "same tenant, other program, literal fleet.admin", auth: auth({ capabilities: ["fleet.admin"] }), doc: { userId: "7viFKVtl", programId: "vector" }, expect: { allowed: true, via: "fleet.admin" } },
    { name: "other tenant, same program", auth: auth(), doc: { userId: "other", programId: "iso" }, expect: { allowed: false, reason: "tenant" } },
    { name: "other tenant, other program, literal fleet.admin", auth: auth({ capabilities: ["fleet.admin"] }), doc: { userId: "other", programId: "vector" }, expect: { allowed: false, reason: "tenant" } },
    { name: "other tenant, same program, fleet.admin", auth: auth({ capabilities: ["fleet.admin"] }), doc: { userId: "other", programId: "iso" }, expect: { allowed: false, reason: "tenant" } },
    { name: "alternate uid of caller tenant, same program", auth: auth(), doc: { userId: "T0NWeYZI", programId: "iso" }, expect: { allowed: true, via: "self" } },
    { name: "alternate uid of caller tenant, other program, no capability", auth: auth(), doc: { userId: "T0NWeYZI", programId: "dispatcher" }, expect: { allowed: false, reason: "program" } },
    { name: "alternate uid of caller tenant, other program, fleet.admin", auth: auth({ capabilities: ["fleet.admin"] }), doc: { userId: "T0NWeYZI", programId: "dispatcher" }, expect: { allowed: true, via: "fleet.admin" } },
    { name: "caller session in the alternate uid, key in canonical", auth: auth({ userId: "T0NWeYZI" }), doc: { userId: "7viFKVtl", programId: "iso" }, expect: { allowed: true, via: "self" } },
    { name: "key document with no userId", auth: auth(), doc: { programId: "iso" }, expect: { allowed: false, reason: "tenant" } },
  ];

  it.each(rows)("$name", async (row) => {
    const d = await authorizeKeySubject(row.auth, row.doc, tenantOf);
    expect(d.allowed).toBe(row.expect.allowed);
    if (d.allowed) expect(d.via).toBe(row.expect.via);
    else expect(d.reason).toBe(row.expect.reason);
  });

  it("a resolution failure rejects instead of deciding", async () => {
    const boom: TenantOf = async (uid) => { throw new TenantResolutionError(uid, new Error("unavailable")); };
    await expect(authorizeKeySubject(auth(), { userId: "7viFKVtl", programId: "iso" }, boom)).rejects.toBeInstanceOf(TenantResolutionError);
  });
});

describe("resolveTenant fails closed", () => {
  it("throws TenantResolutionError when the lookup fails", async () => {
    const db: any = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => { throw new Error("deadline exceeded"); } }) }) }) };
    await expect(resolveTenant("T0NWeYZI", db)).rejects.toBeInstanceOf(TenantResolutionError);
  });
});
