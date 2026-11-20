import { formatRow, inventoryRow, runKeyInventory } from "../../auth/rd5/keyInventory";
import { formatProbeRow, hashPrefix, probeKey } from "../../auth/rd5/probeLiveKeys";

describe("key-inventory", () => {
  it("marks a missing or non-array capabilities field distinctly", () => {
    expect(formatRow(inventoryRow("a".repeat(64), { programId: "p", userId: "u" }))).toContain("MISSING");
    expect(formatRow(inventoryRow("b".repeat(64), { capabilities: "*" }))).toContain("NOT-AN-ARRAY");
    expect(formatRow(inventoryRow("c".repeat(64), { capabilities: ["*", "fleet.read"] }))).toContain('["*","fleet.read"]');
  });

  it("prints prefix 8, program, tenant, active, expiresAt, rotatedTo", () => {
    const line = formatRow(inventoryRow("deadbeef" + "0".repeat(56), {
      programId: "vector", userId: "t1", active: true, expiresAt: new Date("2030-01-01T00:00:00Z"),
      rotatedTo: "x", capabilities: [],
    }));
    expect(line).toMatch(/^deadbeef {2}program=vector {2}tenant=t1 {2}active=true {2}expiresAt=2030-01-01T00:00:00.000Z {2}rotatedTo=present/);
  });

  it("reads only: the db surface has no write method", async () => {
    const db = { collection: () => ({ get: async () => ({ docs: [{ id: "f".repeat(64), data: () => ({ programId: "x" }) }] }) }) };
    expect(await runKeyInventory(db)).toHaveLength(1);
  });
});

describe("probe-live-keys", () => {
  const KEY = "cb_super_secret_key_value";
  function fetchFn(calls: any[], initStatus = 200, tools = 3) {
    return async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ body, headers: init.headers });
      if (body.method === "initialize") {
        return { status: initStatus, headers: { get: () => "sess-1" }, text: async () => "{}" };
      }
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => `data: ${JSON.stringify({ result: { tools: Array.from({ length: tools }, (_, i) => ({ name: `t${i}` })) } })}`,
      };
    };
  }

  it("calls only initialize then tools/list, and reports status and tool count", async () => {
    const calls: any[] = [];
    const row = await probeKey(fetchFn(calls), "https://h.example", KEY);
    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "tools/list"]);
    expect(calls.some((c) => c.body.method === "tools/call")).toBe(false);
    expect(row).toEqual({ hashPrefix: hashPrefix(KEY), status: 200, toolCount: 3 });
  });

  it("never prints the key", async () => {
    const row = await probeKey(fetchFn([]), "https://h.example", KEY);
    expect(hashPrefix(KEY)).toHaveLength(8);
    expect(formatProbeRow(row)).not.toContain(KEY);
  });

  it("reports a rejected key's status with no tool count", async () => {
    const calls: any[] = [];
    const row = await probeKey(fetchFn(calls, 401), "https://h.example", KEY);
    expect(row).toMatchObject({ status: 401, toolCount: "n/a" });
    expect(calls).toHaveLength(1);
  });
});
