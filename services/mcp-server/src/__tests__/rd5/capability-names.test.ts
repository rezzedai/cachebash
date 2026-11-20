import { execFileSync } from "child_process";
import { join } from "path";
import {
  FLEET_ADMIN_CAPABILITY,
  FLEET_OBSERVE_CAPABILITY,
  KEYS_ADMIN_CAPABILITY,
  hasFleetAdminCapability,
  hasFleetObserveCapability,
  isKeyAdmin,
} from "../../auth/ownerAuthz";
import {
  DEFAULT_CAPABILITIES,
  LITERAL_ONLY_CAPABILITIES,
  WINGMAN_TIER_CAPABILITIES,
} from "../../middleware/capabilities";

const auth = (caps: unknown, keyProgramId = "someprog"): any => ({
  userId: "u1", programId: keyProgramId, keyProgramId, capabilities: caps,
});

describe("RD-5 PR-D capability names", () => {
  it("spells the names dotted", () => {
    expect(FLEET_ADMIN_CAPABILITY).toBe("fleet.admin");
    expect(FLEET_OBSERVE_CAPABILITY).toBe("fleet.observe");
    expect(KEYS_ADMIN_CAPABILITY).toBe("keys.admin");
  });

  it("LITERAL_ONLY_CAPABILITIES lists exactly the three names", () => {
    expect([...LITERAL_ONLY_CAPABILITIES].sort()).toEqual(["fleet.admin", "fleet.observe", "keys.admin"]);
  });

  it("no role default holds a literal-only capability", () => {
    for (const [role, caps] of Object.entries(DEFAULT_CAPABILITIES)) {
      for (const lit of LITERAL_ONLY_CAPABILITIES) {
        expect({ role, held: caps.includes(lit) }).toEqual({ role, held: false });
      }
    }
  });

  it("WINGMAN_TIER_CAPABILITIES holds neither fleet.admin nor keys.admin", () => {
    expect(WINGMAN_TIER_CAPABILITIES).not.toContain("fleet.admin");
    expect(WINGMAN_TIER_CAPABILITIES).not.toContain("keys.admin");
  });

  it("a [\"*\"] credential fails both literal helpers", () => {
    expect(hasFleetAdminCapability(auth(["*"]))).toBe(false);
    expect(isKeyAdmin(auth(["*"]))).toBe(false);
    expect(hasFleetObserveCapability(auth(["*"]))).toBe(false);
  });

  it("literal fleet.admin passes hasFleetAdminCapability and isKeyAdmin", () => {
    expect(hasFleetAdminCapability(auth(["fleet.admin"]))).toBe(true);
    expect(isKeyAdmin(auth(["fleet.admin"]))).toBe(true);
  });

  it("keys.admin and the allowlist still pass isKeyAdmin; a missing list fails", () => {
    expect(isKeyAdmin(auth(["keys.admin"]))).toBe(true);
    expect(isKeyAdmin(auth([], "vector"))).toBe(true);
    expect(isKeyAdmin(auth(undefined))).toBe(false);
    expect(hasFleetAdminCapability(auth(undefined))).toBe(false);
  });

  it("D-a: no fleet-observe/fleet_observe/fleet-admin/fleet_admin spelling in non-test src", () => {
    const srcDir = join(__dirname, "..", "..");
    let out = "";
    try {
      out = execFileSync(
        "git",
        ["grep", "-nP", "fleet[-_](observe|admin)", "--", ".", ":(exclude)__tests__", ":(exclude)**/*.test.ts"],
        { cwd: srcDir, encoding: "utf8" }
      );
    } catch (e: any) {
      if (e.status !== 1) throw e; // 1 = no match
    }
    expect(out).toBe("");
  });
});
