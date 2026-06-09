/**
 * Owner-authz gate unit tests (SARK keys.ts gate, tasks fesTTlPTC + #341 re-review).
 *
 * The load-bearing assertion: a "*" wildcard key must NOT be able to provision
 * keys. The SOLE gate is a LITERAL keys.provision grant. uid is irrelevant —
 * the #341 NO-GO proved the old uid/owner branch was a PROD NO-OP, because every
 * cb_ key carries the shared TENANT uid (Flynn's allowlisted uid), not the
 * calling principal, so the branch passed the entire fleet.
 */
import type { AuthContext } from "../auth/authValidator";
import {
  isKeyProvisioner,
  disallowedMintCapabilities,
  KEY_PROVISION_CAPABILITY,
} from "../auth/ownerAuthz";

function authWith(partial: Partial<AuthContext>): AuthContext {
  return {
    userId: "shared-tenant-uid",
    apiKeyHash: "hash",
    programId: "basher",
    encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
    capabilities: [],
    rateLimitTier: "internal",
    ...partial,
  } as AuthContext;
}

describe("isKeyProvisioner", () => {
  it("DENIES a wildcard '*' key (the core escalation fix)", () => {
    expect(isKeyProvisioner(authWith({ capabilities: ["*"] }))).toBe(false);
  });

  it("denies keys.write (the wildcard-satisfiable middleware cap)", () => {
    expect(isKeyProvisioner(authWith({ capabilities: ["keys.write"] }))).toBe(false);
  });

  it("allows a caller holding an explicit, literal keys.provision grant", () => {
    expect(isKeyProvisioner(authWith({ capabilities: [KEY_PROVISION_CAPABILITY] }))).toBe(true);
    expect(isKeyProvisioner(authWith({ capabilities: ["dispatch.read", "keys.provision"] }))).toBe(true);
    // The deliberate owner principal: "*" + keys.provision (granted by name).
    expect(isKeyProvisioner(authWith({ capabilities: ["*", "keys.provision"] }))).toBe(true);
  });

  it("denies a caller with no provisioning grant", () => {
    expect(isKeyProvisioner(authWith({ capabilities: [] }))).toBe(false);
    expect(isKeyProvisioner(authWith({ capabilities: ["dispatch.read", "relay.write"] }))).toBe(false);
  });

  // #341 REGRESSION: the prod no-op. Every cb_ key's userId is the shared tenant
  // uid (Flynn's allowlisted uid). uid must NOT grant provisioning — only the
  // literal cap does. A wildcard key carrying the real tenant uid is still DENIED.
  it("ignores uid entirely — a tenant-uid wildcard key cannot provision (prod no-op fixed)", () => {
    expect(isKeyProvisioner(authWith({
      userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2", // Flynn's allowlisted tenant uid
      capabilities: ["*"],
    }))).toBe(false);
  });

  it("tolerates a missing/non-array capabilities field", () => {
    expect(isKeyProvisioner(authWith({ capabilities: undefined as unknown as string[] }))).toBe(false);
  });
});

describe("disallowedMintCapabilities (SARK #341 capability ceiling)", () => {
  it("lets an owner '*' key grant anything", () => {
    expect(disallowedMintCapabilities(["*"], ["dispatch.read", "relay.write", "*"])).toEqual([]);
    expect(disallowedMintCapabilities(["*", "keys.provision"], ["*"])).toEqual([]);
  });

  it("clamps a bounded provisioner to caps it literally holds", () => {
    const caller = ["dispatch.read", "keys.provision"];
    expect(disallowedMintCapabilities(caller, ["dispatch.read"])).toEqual([]);
    expect(disallowedMintCapabilities(caller, ["dispatch.read", "relay.write"])).toEqual(["relay.write"]);
  });

  it("blocks a bounded provisioner from laundering a wildcard (the whole point)", () => {
    // A keys.provision holder that is NOT itself "*" cannot mint a "*" key.
    expect(disallowedMintCapabilities(["dispatch.read", "keys.provision"], ["*"])).toEqual(["*"]);
  });

  it("treats a missing caller capabilities array as granting nothing", () => {
    expect(disallowedMintCapabilities(undefined, ["dispatch.read"])).toEqual(["dispatch.read"]);
  });
});
