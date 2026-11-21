/**
 * GET /v1/tasks/stats counts the `status` field the task writers store.
 *
 * The route counted `lifecycle`, which no writer sets, so every count read 0.
 * Task documents below carry the shape the create path writes (tasks.ts createTaskHandler:
 * status "created", target, createdAt) and the claim/complete paths (status "active", "done", "failed").
 * Emulator-free: real REST router, in-memory Firestore query surface.
 */

import type { AuthContext } from "../auth/authValidator";
import * as http from "http";
import { createRestRouter } from "../transport/rest";
import { validateAuth } from "../auth/authValidator.js";

type Doc = Record<string, any>;
const DAY = 86_400_000;
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms), __ts: ms });
const tsMs = (v: any) => (v && typeof v === "object" && "__ts" in v ? v.__ts : v);

let docs: Doc[] = [];

function makeQuery(filters: Array<[string, string, any]> = [], lim = Infinity): any {
  const run = () => docs.filter((d) => filters.every(([f, op, v]) => (op === "==" ? d[f] === v : tsMs(d[f]) >= tsMs(v))));
  return {
    where: (f: string, op: string, v: any) => makeQuery([...filters, [f, op, v]], lim),
    orderBy: () => makeQuery(filters, lim),
    limit: (n: number) => makeQuery(filters, n),
    get: async () => ({ docs: run().slice(0, lim).map((d) => ({ data: () => d })) }),
    count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
  };
}

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({ collection: jest.fn(() => makeQuery()) })),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));
jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");
  return { ...actual, Timestamp: { ...actual.Timestamp, fromDate: (d: Date) => ({ __ts: d.getTime() }) } };
});
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() })); // the route lazily imports modules/dispatch/tasks.js, which pulls the ESM-only octokit
jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((_c: string, auth: AuthContext) => auth.programId),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "mock-corr-id"),
  createAuditLogger: jest.fn(() => ({ log: jest.fn(), error: jest.fn() })),
}));
jest.mock("../auth/authValidator.js", () => ({ validateAuth: jest.fn() }));
jest.mock("../tools.js", () => ({ TOOL_HANDLERS: {}, TOOL_DEFINITIONS: [] }));
jest.mock("../modules/ledger.js", () => ({ logToolCall: jest.fn() }));
jest.mock("../modules/trace.js", () => ({ traceToolCall: jest.fn() }));
jest.mock("../middleware/rateLimiter.js", () => ({
  enforceRateLimit: jest.fn(() => ({ allowed: true })),
  checkAuthRateLimit: jest.fn(() => true),
}));
jest.mock("../middleware/sessionCompliance.js", () => ({
  checkSessionCompliance: jest.fn(async () => ({ allowed: true })),
  resetTransportCompliance: jest.fn(),
}));
jest.mock("../middleware/pricingEnforce.js", () => ({ checkPricing: jest.fn(async () => ({ allowed: true })) }));
jest.mock("../middleware/usage.js", () => ({ incrementUsage: jest.fn(), incrementSeatUsage: jest.fn() }));
jest.mock("../middleware/circuitBreaker.js", () => ({ checkCircuitBreaker: jest.fn(async () => ({ allowed: true })) }));
jest.mock("../modules/openapi.js", () => ({ generateOpenApiSpec: jest.fn(() => ({})) }));
jest.mock("../modules/dream.js", () => ({ dreamPeekHandler: jest.fn(), dreamActivateHandler: jest.fn() }));
jest.mock("../modules/gsp.js", () => ({ gspListNamespacesHandler: jest.fn(), gspResolveHandler: jest.fn() }));

function authWith(capabilities: string[]): AuthContext {
  return {
    userId: "uid-1",
    apiKeyHash: "cb_abc123",
    encryptionKey: Buffer.from("abc"),
    programId: "scalar" as any,
    keyProgramId: "scalar" as any,
    capabilities,
    rateLimitTier: "paid",
  } as AuthContext;
}

/** A task document as the create/claim/complete paths store it: `status`, never `lifecycle`. */
const task = (target: string, status: string, ageDays = 0): Doc => ({
  schemaVersion: "2.2", type: "task", title: "t", target, status, priority: "normal",
  requires_action: true, archived: false, createdAt: ts(Date.now() - ageDays * DAY),
});

describe("GET /v1/tasks/stats", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(createRestRouter());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });
  beforeEach(() => {
    docs = [
      ...Array.from({ length: 3 }, () => task("vector", "created")),
      task("vector", "active"),
      task("vector", "done", 30),
      task("basher", "created"),
      task("basher", "failed", 30),
    ];
  });

  async function stats(qs = ""): Promise<any> {
    (validateAuth as jest.Mock).mockResolvedValue(authWith(["dispatch.read", "fleet.observe"]));
    const res = await fetch(`${baseUrl}/v1/tasks/stats${qs}`, { headers: { Authorization: "Bearer cb_test" } });
    if (res.status !== 200) throw new Error(JSON.stringify(await res.json()));
    return ((await res.json()) as any).data;
  }

  it("count() branch (no target, no period) counts status", async () => {
    expect(await stats()).toEqual({ created: 4, active: 1, done: 1, failed: 1, total: 7 });
  });

  it("filtered branch, target=vector", async () => {
    expect(await stats("?target=vector")).toEqual({ created: 3, active: 1, done: 1, failed: 0, total: 5, target: "vector" });
  });

  it("filtered branch, target=basher", async () => {
    expect(await stats("?target=basher")).toEqual({ created: 1, active: 0, done: 0, failed: 1, total: 2, target: "basher" });
  });

  it("filtered branch, period=today excludes the 30-day-old documents", async () => {
    expect(await stats("?period=today")).toEqual({ created: 4, active: 1, done: 0, failed: 0, total: 5, period: "today" });
  });

  it("filtered branch, target and period together", async () => {
    expect(await stats("?target=vector&period=today")).toEqual({ created: 3, active: 1, done: 0, failed: 0, total: 4, target: "vector", period: "today" });
  });
});
