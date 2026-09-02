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

  // ITEM C (dispatch_01a061d9): programCounts used to be initialized ONLY in
  // the TASK_CREATED case, guarding every other case with
  // `&& programCounts[data.program_id]`. A program that completes work in
  // the window but created nothing in it (basher completes tasks iso
  // creates) got no perProgram entry at all -- its completions vanished
  // silently. This must fail on unfixed code by showing basher ABSENT from
  // perProgram, not merely under-counted.
  it("does not drop a program's perProgram entry when it completes tasks but creates none in the window (ITEM C)", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_CREATED", program_id: "iso" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SUCCESS", program_id: "basher" }),
      ev({ event_type: "TASK_SUCCEEDED", completed_status: "SKIPPED", program_id: "basher" }),
    ];
    const data = await runMetrics();
    const basher = data.perProgram.find((p: { program: string }) => p.program === "basher");
    expect(basher).toBeDefined();
    expect(basher.created).toBe(0);
    expect(basher.succeeded).toBe(1);
    expect(basher.skipped).toBe(1);
    // iso still shows its own creation, unaffected by basher's lazy-init
    const iso = data.perProgram.find((p: { program: string }) => p.program === "iso");
    expect(iso.created).toBe(1);
  });

  // ITEM D (dispatch_01a061d9): TASK_UNCLAIMED (unclaim_task) returns a task
  // to status:"created" -- not a completion. It must get its own dedicated
  // tally, must not land in unclassifiedEvents, must not score as any
  // completion outcome, and must not create a perProgram entry (perProgram
  // tracks completion outcomes; an unclaim is the absence of one).
  it("gives TASK_UNCLAIMED its own tally, not unclassified and not a completion outcome (ITEM D)", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_UNCLAIMED", program_id: "basher", reason: "manual", unclaim_count: 1 }),
    ];
    const data = await runMetrics();
    expect(data.tasks.unclaimed).toBe(1);
    expect(data.unclassifiedEvents).toBe(0);
    expect(data.tasks.succeeded).toBe(0);
    expect(data.tasks.failed).toBe(0);
    expect(data.tasks.skipped).toBe(0);
    expect(data.tasks.cancelled).toBe(0);
    expect(data.perProgram.find((p: { program: string }) => p.program === "basher")).toBeUndefined();
  });

  // ITEM D (dispatch_01a061d9): TASK_ABORTED (abort_task) writes
  // status:"done", completed_status:"CANCELLED" directly on the task doc --
  // a genuine terminal completion -- but emits its own event_type instead of
  // TASK_SUCCEEDED. It must be counted as the CANCELLED completion it
  // actually is, not fall into unclassifiedEvents.
  it("counts TASK_ABORTED as a CANCELLED completion, not unclassified (ITEM D)", async () => {
    eventsDocs = [
      ev({ event_type: "TASK_CREATED", program_id: "basher" }),
      ev({ event_type: "TASK_ABORTED", program_id: "basher", previous_status: "active", reason: "stale" }),
    ];
    const data = await runMetrics();
    expect(data.tasks.cancelled).toBe(1);
    expect(data.unclassifiedEvents).toBe(0);
    const basher = data.perProgram.find((p: { program: string }) => p.program === "basher");
    expect(basher.cancelled).toBe(1);
  });

  // ITEM A (dispatch_01a061d9): programHealthScores' `failed` used to mean
  // "completed_status !== SUCCESS", lumping FAILED/SKIPPED/CANCELLED/PARTIAL
  // together -- the same miscategorization #427 already fixed for the
  // top-level event counters above, still standing in this separate block
  // that scans the tasks collection directly. `failed` must mean strictly
  // completed_status === "FAILED"; SKIPPED/CANCELLED/PARTIAL get their own
  // fields instead of being folded in or dropped.
  describe("programHealthScores discrimination (ITEM A)", () => {
    it("discriminates completed_status per program instead of lumping non-SUCCESS into failed", async () => {
      tasksDocs = [
        ev({ target: "iso", completed_status: "SUCCESS" }),
        ev({ target: "iso", completed_status: "SKIPPED" }),
        ev({ target: "iso", completed_status: "CANCELLED" }),
        ev({ target: "iso", completed_status: "PARTIAL" }),
        ev({ target: "iso", completed_status: "FAILED" }),
      ];
      const data = await runMetrics();
      const iso = data.programHealthScores.iso;
      expect(iso.totalTasks).toBe(5);
      expect(iso.succeeded).toBe(1);
      expect(iso.skipped).toBe(1);
      expect(iso.cancelled).toBe(1);
      expect(iso.partial).toBe(1);
      expect(iso.failed).toBe(1);
      // successRate is succeeded/totalTasks, not (totalTasks - failed)/totalTasks
      expect(iso.successRate).toBeCloseTo(20, 4);
    });

    it("treats an absent completed_status on a task doc as succeeded (legacy tasks predate the field)", async () => {
      tasksDocs = [ev({ target: "iso" })];
      const data = await runMetrics();
      expect(data.programHealthScores.iso.succeeded).toBe(1);
      expect(data.programHealthScores.iso.failed).toBe(0);
    });

    it("keys programHealthScores on target/source (assignee), independent of perProgram's program_id (completer) keying (ITEM B)", async () => {
      // iso creates+targets the task; the dispatcher completes it (a
      // [RECYCLE]-style SKIP close). perProgram must key on the completer
      // (dispatcher); programHealthScores must key on the assignee (iso).
      eventsDocs = [
        ev({ event_type: "TASK_CREATED", program_id: "iso" }),
        ev({ event_type: "TASK_SUCCEEDED", completed_status: "SKIPPED", program_id: "dispatcher" }),
      ];
      tasksDocs = [ev({ target: "iso", source: "iso", completed_status: "SKIPPED" })];
      const data = await runMetrics();

      const dispatcherPerProgram = data.perProgram.find((p: { program: string }) => p.program === "dispatcher");
      expect(dispatcherPerProgram).toBeDefined();
      expect(dispatcherPerProgram.skipped).toBe(1);
      expect(data.perProgram.find((p: { program: string }) => p.program === "iso").created).toBe(1);

      expect(data.programHealthScores.iso).toBeDefined();
      expect(data.programHealthScores.iso.skipped).toBe(1);
      expect(data.programHealthScores.dispatcher).toBeUndefined();
    });
  });
});
