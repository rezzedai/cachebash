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
