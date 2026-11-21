import { planGrant, runGrant } from "../../auth/rd5/grantCapability";
import { ALL_CAPABILITIES, LITERAL_ONLY_CAPABILITIES, DEFAULT_CAPABILITIES, TOOL_CAPABILITIES, type Capability } from "../../middleware/capabilities";

const HASH = "a".repeat(64);
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);
const UNION = (...v: string[]) => ({ __arrayUnion: v });

function fakeDb(data: Record<string, unknown> | undefined) {
  const updates: Array<{ ref: unknown; data: Record<string, unknown> }> = [];
  const db = {
    doc: (p: string) => p,
    runTransaction: async (fn: any) =>
      fn({
        get: async () => ({ exists: data !== undefined, data: () => data }),
        update: (ref: unknown, d: Record<string, unknown>) => updates.push({ ref, data: d }),
      }),
  };
  return { db, updates };
}
const run = (data: Record<string, unknown> | undefined, over: object = {}) => {
  const f = fakeDb(data);
  return runGrant(f.db, { keyHash: HASH, add: "fleet.admin", apply: true, arrayUnion: UNION, ...over }).then((r) => ({ r, ...f }));
};

describe("grant-capability refusals", () => {
  it("refuses when capabilities is missing", async () => {
    const { r, updates } = await run({ active: true, programId: "p" });
    expect(r.ok).toBe(false);
    expect(r.lines.join()).toMatch(/missing/);
    expect(updates).toHaveLength(0);
  });

  it("refuses when capabilities is null", async () => {
    const { r, updates } = await run({ capabilities: null });
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses when capabilities is not an array", async () => {
    for (const bad of ["*", { a: 1 }, 5, true]) {
      const { r, updates } = await run({ capabilities: bad });
      expect(r.ok).toBe(false);
      expect(r.lines.join()).toMatch(/not an array/);
      expect(updates).toHaveLength(0);
    }
  });

  it("refuses an empty capabilities array (validator reads [] as role defaults)", async () => {
    const { r, updates } = await run({ capabilities: [], active: true });
    expect(r.ok).toBe(false);
    expect(r.lines.join()).toMatch(/empty array/);
    expect(r.lines.join()).toContain("authValidator.ts:83-85");
    expect(r.lines.join()).toContain("getDefaultCapabilities");
    expect(updates).toHaveLength(0);
  });

  it("refuses an inactive key", async () => {
    const { r, updates } = await run({ capabilities: ["*"], active: false });
    expect(r.ok).toBe(false);
    expect(r.lines.join()).toMatch(/inactive/);
    expect(updates).toHaveLength(0);
  });

  it("refuses a revoked key", async () => {
    const { r } = await run({ capabilities: ["*"], revokedAt: new Date() });
    expect(r.ok).toBe(false);
  });

  it("refuses an expired key (Date and Timestamp-like)", async () => {
    for (const exp of [PAST, { toDate: () => PAST }]) {
      const { r, updates } = await run({ capabilities: ["*"], expiresAt: exp });
      expect(r.ok).toBe(false);
      expect(r.lines.join()).toMatch(/expired/);
      expect(updates).toHaveLength(0);
    }
  });

  it("refuses a missing document, a short hash, the wildcard and an empty capability", async () => {
    expect((await run(undefined)).r.ok).toBe(false);
    expect((await run({ capabilities: [] }, { keyHash: "abc" })).r.ok).toBe(false);
    expect((await run({ capabilities: [] }, { add: "*" })).r.ok).toBe(false);
    expect((await run({ capabilities: [] }, { add: " " })).r.ok).toBe(false);
  });
});

describe("grant-capability --add is restricted to the Capability union", () => {
  const live = { capabilities: ["*", "fleet.read"], active: true, expiresAt: FUTURE, programId: "vector" };

  it("refuses a typo, nonzero, naming the valid list", async () => {
    const { r, updates } = await run(live, { add: "fleet.obsrve" });
    expect(r.ok).toBe(false);
    expect(r.lines.join()).toMatch(/unknown capability fleet\.obsrve; valid: .*fleet\.observe/);
    expect(updates).toHaveLength(0);
    expect(planGrant(live, "nope").ok).toBe(false);
  });

  it("keys.admin is an unknown capability and is refused", async () => {
    const { r, updates } = await run(live, { add: "keys.admin", apply: true });
    expect(r.ok).toBe(false);
    expect(r.lines.join()).toMatch(/unknown capability keys\.admin/);
    expect(updates).toHaveLength(0);
  });

  it.each(["fleet.observe", "fleet.admin"])("accepts %s in dry-run", async (cap) => {
    const { r, updates } = await run(live, { add: cap, apply: false });
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(0);
    expect(r.lines.join("\n")).toContain(`"${cap}"]`);
  });

  it("the runtime list matches the union and every literal-only name is in it", () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
    // Compile-time: each value used elsewhere as a Capability must be in the list.
    const used: Capability[] = [...Object.values(TOOL_CAPABILITIES), ...Object.values(DEFAULT_CAPABILITIES).flat()];
    for (const c of used) expect(ALL_CAPABILITIES).toContain(c);
    for (const c of LITERAL_ONLY_CAPABILITIES) expect(ALL_CAPABILITIES).toContain(c);
    for (const c of ALL_CAPABILITIES) expect(planGrant({ capabilities: ["x"] }, c).ok).toBe(true);
  });
});

describe("grant-capability behaviour", () => {
  const live = { capabilities: ["*", "fleet.read"], active: true, expiresAt: FUTURE, programId: "vector" };

  it("dry-run is the default shape: no write, prints before and after", async () => {
    const { r, updates } = await run(live, { apply: false });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(updates).toHaveLength(0);
    expect(r.lines.join("\n")).toContain('before: ["*","fleet.read"]');
    expect(r.lines.join("\n")).toContain('after:  ["*","fleet.read","fleet.admin"]');
  });

  it("--apply writes one arrayUnion on capabilities and no other field", async () => {
    const { r, updates } = await run(live, { apply: true });
    expect(r.applied).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].ref).toBe(`keyIndex/${HASH}`);
    expect(updates[0].data).toEqual({ capabilities: { __arrayUnion: ["fleet.admin"] } });
    expect(Object.keys(updates[0].data)).toEqual(["capabilities"]);
  });

  it("an already-held capability writes nothing", async () => {
    const { r, updates } = await run({ ...live, capabilities: ["fleet.admin"] });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("exposes no remove, rotate or revoke mode", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../auth/rd5/grantCapability.ts"), "utf8");
    expect(src).not.toMatch(/arrayRemove|\.delete\(|rotatedTo\s*:|revokedAt\s*:|\.set\(/);
  });
});
