/**
 * Owner-authz gate unit tests (SARK keys.ts gate, task fesTTlPTC).
 *
 * The load-bearing assertion: a "*" wildcard key must NOT be able to provision
 * keys. Only the platform owner (uid allowlist) or an explicit, literal
 * keys.provision grant may.
 */

// Control the Flynn allowlist without pulling the real OAuth/Firestore chain.
const mockGetAllowedUids = jest.fn<string[], []>(() => ["flynn-uid"]);
jest.mock("../oauth/callback", () => ({
  getAllowedUids: () => mockGetAllowedUids(),
}));

import type { AuthContext } from "../auth/authValidator";
import { isKeyProvisioner, KEY_PROVISION_CAPABILITY } from "../auth/ownerAuthz";

function authWith(partial: Partial<AuthContext>): AuthContext {
  return {
    userId: "some-program-user",
    apiKeyHash: "hash",
    programId: "basher",
    encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
    capabilities: [],
    rateLimitTier: "internal",
    ...partial,
  } as AuthContext;
}

describe("isKeyProvisioner", () => {
  beforeEach(() => {
    mockGetAllowedUids.mockReturnValue(["flynn-uid"]);
  });

  it("allows the platform owner (uid in allowlist) regardless of capabilities", () => {
    expect(isKeyProvisioner(authWith({ userId: "flynn-uid", capabilities: [] }))).toBe(true);
    expect(isKeyProvisioner(authWith({ userId: "flynn-uid", capabilities: ["dispatch.read"] }))).toBe(true);
  });

  it("DENIES a wildcard '*' key that is not the owner (the core escalation fix)", () => {
    expect(isKeyProvisioner(authWith({ userId: "leaked-builder", capabilities: ["*"] }))).toBe(false);
  });

  it("denies keys.write (the wildcard-satisfiable middleware cap) when not owner", () => {
    expect(isKeyProvisioner(authWith({ userId: "leaked-builder", capabilities: ["keys.write"] }))).toBe(false);
  });

  it("allows a non-owner holding an explicit, literal keys.provision grant", () => {
    expect(isKeyProvisioner(authWith({ userId: "provisioner", capabilities: [KEY_PROVISION_CAPABILITY] }))).toBe(true);
    expect(isKeyProvisioner(authWith({ userId: "provisioner", capabilities: ["dispatch.read", "keys.provision"] }))).toBe(true);
  });

  it("denies a non-owner with no provisioning grant", () => {
    expect(isKeyProvisioner(authWith({ userId: "nobody", capabilities: [] }))).toBe(false);
    expect(isKeyProvisioner(authWith({ userId: "nobody", capabilities: ["dispatch.read", "relay.write"] }))).toBe(false);
  });

  it("honors an env-driven allowlist change (no code change)", () => {
    mockGetAllowedUids.mockReturnValue(["new-owner-uid"]);
    expect(isKeyProvisioner(authWith({ userId: "new-owner-uid", capabilities: [] }))).toBe(true);
    expect(isKeyProvisioner(authWith({ userId: "flynn-uid", capabilities: ["*"] }))).toBe(false);
  });
});
