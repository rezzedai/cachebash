/**
 * OAuth → SCALAR program binding — unit tests (no emulator required).
 *
 * Covers the pure logic behind the claude.ai web/mobile connector enablement:
 * 1. Consent-screen program allowlist (scalar | oauth only, never Grid "*"-roles)
 * 2. SCALAR's explicit capability set (no keys.*, no admin, no wildcard)
 * 3. OAuth scope enforcement on canonical (domain-prefixed) tool names
 */

import { OAUTH_PROGRAM_OPTIONS, DEFAULT_OAUTH_PROGRAM, isAllowedOAuthProgram } from "../oauth/consent";
import { isAllowedPrincipal, getAllowedEmails, getAllowedUids } from "../oauth/callback";
import { checkToolScope } from "../oauth/scopes";
import { DEFAULT_CAPABILITIES, getDefaultCapabilities } from "../middleware/capabilities";
import { isRegisteredProgram, isValidProgram, PROGRAM_REGISTRY } from "../config/programs";

describe("OAuth program binding allowlist", () => {
  it("allows only the scalar identity (generic oauth removed — SARK gate)", () => {
    expect(OAUTH_PROGRAM_OPTIONS.map((p) => p.id)).toEqual(["scalar"]);
    expect(isAllowedOAuthProgram("scalar")).toBe(true);
    expect(isAllowedOAuthProgram("oauth")).toBe(false);
  });

  it("rejects privileged Grid identities and unknowns", () => {
    for (const id of ["basher", "iso", "vector", "sark", "admin", "legacy", "dispatcher", "", "oauth", "oauth-service"]) {
      expect(isAllowedOAuthProgram(id)).toBe(false);
    }
  });

  it("pre-selects SCALAR on the consent screen", () => {
    expect(DEFAULT_OAUTH_PROGRAM).toBe("scalar");
    expect(isAllowedOAuthProgram(DEFAULT_OAUTH_PROGRAM)).toBe(true);
  });
});

describe("Flynn-only principal allowlist (callback)", () => {
  const ENV_KEYS = ["OAUTH_ALLOWED_EMAILS", "OAUTH_ALLOWED_UIDS"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to Flynn's two emails and the rezzed.ai uid", () => {
    expect(getAllowedEmails()).toEqual(["christianbourlier@gmail.com", "christian@rezzed.ai"]);
    expect(getAllowedUids()).toEqual(["7viFKVtl5lgzguhFoZlnYYrqeDG2"]);
  });

  it("allows allowlisted principals with verified emails (case-insensitive)", () => {
    expect(isAllowedPrincipal({ uid: "x", email: "christianbourlier@gmail.com", email_verified: true })).toBe(true);
    expect(isAllowedPrincipal({ uid: "x", email: "christian@rezzed.ai", email_verified: true })).toBe(true);
    expect(isAllowedPrincipal({ uid: "x", email: "ChristianBourlier@Gmail.com", email_verified: true })).toBe(true);
  });

  it("rejects unverified emails even when allowlisted (GitHub provider risk)", () => {
    expect(isAllowedPrincipal({ uid: "x", email: "christianbourlier@gmail.com", email_verified: false })).toBe(false);
    expect(isAllowedPrincipal({ uid: "x", email: "christianbourlier@gmail.com" })).toBe(false);
  });

  it("rejects non-allowlisted accounts", () => {
    expect(isAllowedPrincipal({ uid: "attacker", email: "evil@example.com", email_verified: true })).toBe(false);
    expect(isAllowedPrincipal({ uid: "attacker" })).toBe(false);
    expect(isAllowedPrincipal({ uid: "attacker", email: "", email_verified: true })).toBe(false);
  });

  it("accepts the known uid regardless of email claims", () => {
    expect(isAllowedPrincipal({ uid: "7viFKVtl5lgzguhFoZlnYYrqeDG2" })).toBe(true);
    expect(isAllowedPrincipal({ uid: "7viFKVtl5lgzguhFoZlnYYrqeDG2", email: "anything@else.com", email_verified: false })).toBe(true);
  });

  it("honors env overrides without falling back to defaults", () => {
    process.env.OAUTH_ALLOWED_EMAILS = " Alice@Example.com , bob@example.com ";
    process.env.OAUTH_ALLOWED_UIDS = "uid-1, uid-2";
    expect(getAllowedEmails()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(getAllowedUids()).toEqual(["uid-1", "uid-2"]);
    // Defaults no longer apply when env is set
    expect(isAllowedPrincipal({ uid: "x", email: "christianbourlier@gmail.com", email_verified: true })).toBe(false);
    expect(isAllowedPrincipal({ uid: "7viFKVtl5lgzguhFoZlnYYrqeDG2" })).toBe(false);
    expect(isAllowedPrincipal({ uid: "uid-1" })).toBe(true);
    expect(isAllowedPrincipal({ uid: "x", email: "alice@example.com", email_verified: true })).toBe(true);
  });

  it("treats whitespace-only env as unset (defaults apply)", () => {
    process.env.OAUTH_ALLOWED_EMAILS = "   ";
    expect(getAllowedEmails()).toEqual(["christianbourlier@gmail.com", "christian@rezzed.ai"]);
  });
});

describe("SCALAR program registration", () => {
  it("is a registered program with display metadata", () => {
    expect(isRegisteredProgram("scalar")).toBe(true);
    expect(isValidProgram("scalar")).toBe(true);
    expect(PROGRAM_REGISTRY.scalar?.displayName).toBe("SCALAR");
  });
});

describe("SCALAR capability set", () => {
  const caps = getDefaultCapabilities("scalar");

  it("grants the minted operational read+write set", () => {
    for (const cap of [
      "dispatch.read", "dispatch.write",
      "relay.read", "relay.write",
      "pulse.read", "pulse.write",
      "signal.read", "signal.write",
      "gsp.read", "gsp.write",
      "state.read", "state.write",
      "sprint.read", "metrics.read", "fleet.read", "programs.read",
    ]) {
      expect(caps).toContain(cap);
    }
  });

  it("never grants wildcard, keys, audit, or programs.write", () => {
    expect(caps).not.toContain("*");
    expect(caps).not.toContain("keys.read");
    expect(caps).not.toContain("keys.write");
    expect(caps).not.toContain("audit.read");
    expect(caps).not.toContain("programs.write");
    expect(caps).not.toContain("sprint.write");
  });

  it("is strictly narrower than Grid program wildcards", () => {
    expect(DEFAULT_CAPABILITIES.basher).toEqual(["*"]);
    expect(DEFAULT_CAPABILITIES.scalar).not.toContain("*");
  });
});

describe("OAuth scope enforcement on canonical tool names", () => {
  it("requires mcp:write for canonical write tools", () => {
    expect(checkToolScope("dispatch_create_task", ["mcp:read"])).toMatch(/mcp:write/);
    expect(checkToolScope("relay_send_message", ["mcp:read"])).toMatch(/mcp:write/);
    expect(checkToolScope("dispatch_create_task", ["mcp:write"])).toBeNull();
    expect(checkToolScope("dispatch_create_task", ["mcp:full"])).toBeNull();
  });

  it("allows canonical read tools with mcp:read", () => {
    expect(checkToolScope("dispatch_get_tasks", ["mcp:read"])).toBeNull();
    expect(checkToolScope("pulse_get_fleet_health", ["mcp:read"])).toBeNull();
  });

  it("requires mcp:admin for key management", () => {
    expect(checkToolScope("keys_create_key", ["mcp:full"])).toMatch(/mcp:admin/);
    expect(checkToolScope("keys_rotate_key", ["mcp:full"])).toMatch(/mcp:admin/);
    expect(checkToolScope("keys_create_key", ["mcp:admin"])).toBeNull();
  });

  it("still enforces legacy flat aliases via the explicit map", () => {
    expect(checkToolScope("create_task", ["mcp:read"])).toMatch(/mcp:write/);
    expect(checkToolScope("get_tasks", ["mcp:read"])).toBeNull();
    expect(checkToolScope("create_key", ["mcp:full"])).toMatch(/mcp:admin/);
  });

  it("permits unknown tools (capability gate still applies)", () => {
    expect(checkToolScope("totally_unknown_tool", ["mcp:read"])).toBeNull();
  });
});
