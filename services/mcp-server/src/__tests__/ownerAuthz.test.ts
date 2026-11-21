/**
 * Owner-authz gate unit tests (SARK keys.ts gate, tasks fesTTlPTC + #341 re-review).
 *
 * The load-bearing assertion: a "*" wildcard key must NOT be able to provision
 * keys. The SOLE gate is a LITERAL keys.provision grant. uid is irrelevant —
 * the #341 NO-GO proved the old uid/owner branch was a PROD NO-OP, because every
 * cb_ key carries the shared TENANT uid (the owner's allowlisted uid), not the
 * calling principal, so the branch passed the entire fleet.
 */
import type { AuthContext } from "../auth/authValidator";
import {
  isKeyProvisioner,
  disallowedMintCapabilities,
  KEY_PROVISION_CAPABILITY,
  isKeyAdmin,
  credentialPrincipal,
  hasFleetObserveCapability,
  FLEET_OBSERVE_CAPABILITY,
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
  // uid (the owner's allowlisted uid). uid must NOT grant provisioning — only the
  // literal cap does. A wildcard key carrying the real tenant uid is still DENIED.
  it("ignores uid entirely — a tenant-uid wildcard key cannot provision (prod no-op fixed)", () => {
    expect(isKeyProvisioner(authWith({
      userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2", // the owner's allowlisted tenant uid
      capabilities: ["*"],
    }))).toBe(false);
  });

  it("tolerates a missing/non-array capabilities field", () => {
    expect(isKeyProvisioner(authWith({ capabilities: undefined as unknown as string[] }))).toBe(false);
  });
});

describe("disallowedMintCapabilities (SARK #341 capability ceiling)", () => {
  it("a '*' key grants nothing (RD-5 PR-N): the wildcard holds no capability by name", () => {
    expect(disallowedMintCapabilities(["*"], ["dispatch.read", "relay.write"])).toEqual(["dispatch.read", "relay.write"]);
    expect(disallowedMintCapabilities(["*", "keys.provision"], ["*"])).toEqual([]); // it names the wildcard itself; N-D3 stops issuing it
    expect(disallowedMintCapabilities(["*", "keys.provision"], ["fleet.observe"])).toEqual(["fleet.observe"]);
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

describe("BUG-009: key administration authorization", () => {
  const authFor = (
    keyProgramId: string,
    capabilities: string[] = ["*"],
    programId?: string,
  ): any => ({
    userId: "shared-tenant-uid",
    apiKeyHash: "hash",
    encryptionKey: Buffer.from(""),
    programId: (programId ?? keyProgramId) as any,
    keyProgramId: keyProgramId as any,
    capabilities,
    rateLimitTier: "free",
  });

  it("credentialPrincipal ignores a divergent auth.programId", () => {
    // programId escalated to an admin-tier name; the credential is still radia.
    const auth = authFor("radia", ["*"], "dispatcher");
    expect(credentialPrincipal(auth)).toBe("radia");
  });

  it('a "*" wildcard key is NOT a key admin — this is the #341 no-op class', () => {
    // radia holds ["*"] in production and is the key BUG-009 was proven with.
    // A wildcard-expanding capability check here would authorize the very
    // caller the control exists to stop.
    expect(isKeyAdmin(authFor("radia", ["*"]))).toBe(false);
  });

  it("fleet.read does not confer key administration", () => {
    expect(isKeyAdmin(authFor("tensor", ["fleet.read", "programs.read"]))).toBe(false);
  });

  it("a divergent auth.programId of vector does not confer key administration", () => {
    // The credential decides, not auth.programId.
    expect(isKeyAdmin(authFor("radia", ["*"], "vector"))).toBe(false);
  });

  it("vector and sark by NAME, without fleet.admin, are NOT key admins", () => {
    expect(isKeyAdmin(authFor("vector", ["*"]))).toBe(false);
    expect(isKeyAdmin(authFor("sark", ["*"]))).toBe(false);
    expect(isKeyAdmin(authFor("vector", ["dispatch.read"]))).toBe(false);
    expect(isKeyAdmin(authFor("sark", []))).toBe(false);
  });

  it("iso is NOT a key admin", () => {
    expect(isKeyAdmin(authFor("iso", ["*"]))).toBe(false);
  });

  it("keys.admin confers nothing: the name is deleted", () => {
    expect(isKeyAdmin(authFor("tensor", ["dispatch.read", "keys.admin"]))).toBe(false);
  });

  it("a literal fleet.admin grant confers it, on any program name", () => {
    expect(isKeyAdmin(authFor("tensor", ["dispatch.read", "fleet.admin"]))).toBe(true);
    expect(isKeyAdmin(authFor("vector", ["*", "fleet.admin"]))).toBe(true);
  });
});

describe("R4/PR-3: hasFleetObserveCapability (gsp_bootstrap foreign-read gate)", () => {
  function authWith(capabilities: string[]): AuthContext {
    return {
      userId: "shared-tenant-uid",
      apiKeyHash: "hash",
      programId: "vector",
      encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
      capabilities,
      rateLimitTier: "internal",
    } as AuthContext;
  }

  it('a "*" wildcard key does NOT satisfy it — the exact class both prior bugs were proven with', () => {
    expect(hasFleetObserveCapability(authWith(["*"]))).toBe(false);
  });

  it("the legacy fleet.read capability does NOT satisfy it — this is a genuinely new capability, not a rename", () => {
    expect(hasFleetObserveCapability(authWith(["fleet.read"]))).toBe(false);
    expect(hasFleetObserveCapability(authWith(["*", "fleet.read"]))).toBe(false);
  });

  it("an explicit literal fleet.observe grant satisfies it, alone or alongside '*'", () => {
    expect(hasFleetObserveCapability(authWith([FLEET_OBSERVE_CAPABILITY]))).toBe(true);
    expect(hasFleetObserveCapability(authWith(["*", "fleet.observe"]))).toBe(true);
  });

  it("denies a caller with no capabilities at all", () => {
    expect(hasFleetObserveCapability(authWith([]))).toBe(false);
  });

  it("tolerates a missing/non-array capabilities field", () => {
    expect(hasFleetObserveCapability(authWith(undefined as unknown as string[]))).toBe(false);
  });
});
