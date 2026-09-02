/**
 * get_operational_metrics — completed_status discrimination
 * RULED, dispatch_01a061b1: event_type (TASK_SUCCEEDED/TASK_FAILED) is only a
 * coarse routing hint; completed_status is the authoritative discriminator
 * between SUCCESS/FAILED/SKIPPED/CANCELLED/PARTIAL. A SKIPPED/CANCELLED/PARTIAL
 * completion emits TASK_SUCCEEDED and must NOT score as a success. A
 * TASK_EXPIRED_INCOMPLETE event (#425) must not go invisible, and any future
 * unrecognized event_type must land in `unclassifiedEvents`, not disappear.
 *
 * Scoped to its own mock (distinct from metrics-endpoints.test.ts) so the
 * events and tasks collections can be seeded independently per test.
 */

import { getOperationalMetricsHandler } from "../modules/metrics.js";
import type { AuthContext } from "../auth/authValidator.js";

type FakeDoc = { data: () => Record<string, unknown> };

function makeQuery(docs: FakeDoc[]) {
  return {
    where: jest.fn().mockReturnThis(),
    get: jest.fn(() => Promise.resolve({ docs, size: docs.length })),
  };
}

let eventsDocs: FakeDoc[] = [];
let tasksDocs: FakeDoc[] = [];

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((path: string) => {
      if (path.endsWith("/events")) return makeQuery(eventsDocs);
      if (path.endsWith("/tasks")) return makeQuery(tasksDocs);
      return makeQuery([]);
    }),
  })),
}));

function ev(data: Record<string, unknown>): FakeDoc {
  return { data: () => data };
}

const adminAuth: AuthContext = {
  userId: "test-user",
  programId: "orchestrator",
  apiKeyHash: "test-hash",
  encryptionKey: Buffer.from("test-encryption-key-32-bytes-long!!!"),
  capabilities: ["*"],
  rateLimitTier: "standard",
};

async function runMetrics() {
  const result = await getOperationalMetricsHandler(adminAuth, { period: "all" });
  return JSON.parse(result.content[0].text);
}

describe("get_operational_metrics — completed_status discrimination (RULED dispatch_01a061b1)", () => {
  beforeEach(() => {
    eventsDocs = [];
    tasksDocs = [];
  });

  it("counts completed_status: SUCCESS as succeeded", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED", completed_status: "SUCCESS" })];
    const data = await runMetrics();
    expect(data.tasks.succeeded).toBe(1);
    expect(data.tasks.skipped).toBe(0);
    expect(data.tasks.cancelled).toBe(0);
    expect(data.tasks.partial).toBe(0);
  });

  it("treats an absent completed_status as succeeded (legacy events predate the field)", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED" })];
    const data = await runMetrics();
    expect(data.tasks.succeeded).toBe(1);
    expect(data.unclassifiedEvents).toBe(0);
  });

  it("counts completed_status: SKIPPED separately, not as succeeded or failed", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED", completed_status: "SKIPPED" })];
    const data = await runMetrics();
    expect(data.tasks.skipped).toBe(1);
    expect(data.tasks.succeeded).toBe(0);
    expect(data.tasks.failed).toBe(0);
  });

  it("counts completed_status: CANCELLED separately, not as succeeded or failed", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED", completed_status: "CANCELLED" })];
    const data = await runMetrics();
    expect(data.tasks.cancelled).toBe(1);
    expect(data.tasks.succeeded).toBe(0);
    expect(data.tasks.failed).toBe(0);
  });

  it("counts completed_status: PARTIAL separately, not as succeeded or failed", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED", completed_status: "PARTIAL" })];
    const data = await runMetrics();
    expect(data.tasks.partial).toBe(1);
    expect(data.tasks.succeeded).toBe(0);
    expect(data.tasks.failed).toBe(0);
  });

  it("counts TASK_FAILED as failed", async () => {
    eventsDocs = [ev({ event_type: "TASK_FAILED", completed_status: "FAILED" })];
    const data = await runMetrics();
    expect(data.tasks.failed).toBe(1);
  });

  it("counts TASK_EXPIRED_INCOMPLETE explicitly — positive control: this event is invisible on unfixed code", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_EXPIRED_INCOMPLETE", task_id: "t1", target: "basher", source: "enrichment-worker", was_claimed: false }),
    ];
    const data = await runMetrics();
    expect(data.tasks.expiredIncomplete).toBe(1);
    expect(data.unclassifiedEvents).toBe(0);
    expect(data.tasks.succeeded).toBe(0);
    expect(data.tasks.failed).toBe(0);
  });

  it("routes an unrecognized event_type into unclassifiedEvents via the default arm", async () => {
    eventsDocs = [ev({ event_type: "SOME_FUTURE_EVENT_TYPE" })];
    const data = await runMetrics();
    expect(data.unclassifiedEvents).toBe(1);
    expect(data.totalEvents).toBe(1);
  });

  it("routes a TASK_SUCCEEDED with an unrecognized completed_status into unclassifiedEvents", async () => {
    eventsDocs = [ev({ event_type: "TASK_SUCCEEDED", completed_status: "SOME_UNKNOWN_VALUE" })];
    const data = await runMetrics();
    expect(data.unclassifiedEvents).toBe(1);
    expect(data.tasks.succeeded).toBe(0);
  });

  // R-metrics-2: a brand-new/buggy event_type must be DISTINGUISHABLE in the
  // response as its own key, not merely folded into the flat total -- a test
  // that only checked the total incrementing would have passed against the
  // broken code (event types this handler deliberately doesn't classify, like
  // RELAY_DELIVERED/SESSION_*/PROGRAM_*/BUDGET_*, already dominate that total
  // and would mask a genuinely new TASK_* type showing up there).
  it("surfaces a brand-new unrecognized event_type as its own key in unclassifiedEventTypes", async () => {
    eventsDocs = [
      ev({ event_type: "TOTALLY_MADE_UP_EVENT_TYPE_FOR_TEST" }),
      ev({ event_type: "TOTALLY_MADE_UP_EVENT_TYPE_FOR_TEST" }),
      ev({ event_type: "RELAY_DELIVERED" }), // a different, pre-existing unhandled type -- must not merge
    ];
    const data = await runMetrics();
    expect(data.unclassifiedEventTypes["TOTALLY_MADE_UP_EVENT_TYPE_FOR_TEST"]).toBe(2);
    expect(data.unclassifiedEventTypes["RELAY_DELIVERED"]).toBe(1);
    expect(data.unclassifiedEvents).toBe(3);
  });

  it("keys a TASK_SUCCEEDED with an unrecognized completed_status under its own TASK_SUCCEEDED:<status> key, distinguishable from an unhandled event_type", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "FOO" }),
      ev({ event_type: "SOME_FUTURE_EVENT_TYPE" }),
    ];
    const data = await runMetrics();
    expect(data.unclassifiedEventTypes["TASK_SUCCEEDED:FOO"]).toBe(1);
    expect(data.unclassifiedEventTypes["SOME_FUTURE_EVENT_TYPE"]).toBe(1);
    // must not collide with a real/unhandled event_type key
    expect(data.unclassifiedEventTypes["TASK_SUCCEEDED"]).toBeUndefined();
    expect(data.unclassifiedEvents).toBe(2);
  });

  // Item 1b (ISO amendment): perProgram must not lose skipped/cancelled/
  // partial completions. Before the fix, only the SUCCESS branch updated
  // programCounts -- a skipped/cancelled/partial completion for a program
  // was invisible in perProgram (previously it was miscounted as a success).
  it("breaks down perProgram by skipped/cancelled/partial, not just created/succeeded/failed", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_CREATED", program_id: "basher" }),
      ev({ event_type: "TASK_CREATED", program_id: "basher" }),
      ev({ event_type: "TASK_CREATED", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SUCCESS", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SKIPPED", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "CANCELLED", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "PARTIAL", program_id: "basher" }),
      ev({ event_type: "TASK_FAILED", completed_status: "FAILED", program_id: "basher" }),
    ];
    const data = await runMetrics();
    const basher = data.perProgram.find((p: { program: string }) => p.program === "basher");
    expect(basher).toBeDefined();
    expect(basher.created).toBe(3);
    expect(basher.succeeded).toBe(1);
    expect(basher.failed).toBe(1);
    expect(basher.skipped).toBe(1);
    expect(basher.cancelled).toBe(1);
    expect(basher.partial).toBe(1);
  });

  it("includes SKIPPED/CANCELLED/PARTIAL/TASK_EXPIRED_INCOMPLETE in the firstPassSuccessRate denominator", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_CREATED", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SUCCESS" }),
      ev({ event_type: "TASK_SUCCEEDED" }), // legacy absent -> succeeded
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SKIPPED" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "CANCELLED" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "PARTIAL" }),
      ev({ event_type: "TASK_FAILED", completed_status: "FAILED" }),
      ev({ event_type: "TASK_EXPIRED_INCOMPLETE" }),
    ];
    const data = await runMetrics();

    expect(data.tasks.succeeded).toBe(2);
    expect(data.tasks.skipped).toBe(1);
    expect(data.tasks.cancelled).toBe(1);
    expect(data.tasks.partial).toBe(1);
    expect(data.tasks.failed).toBe(1);
    expect(data.tasks.expiredIncomplete).toBe(1);
    // 2 succeeded / (2 succeeded + 5 non-success outcomes) * 100
    expect(data.tasks.firstPassSuccessRate).toBeCloseTo((2 / 7) * 100, 4);
  });
});
