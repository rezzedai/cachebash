import { classifyForBackfill } from "../modules/dispatch/expiresAtBackfillClassifier.js";
import { CONSTANTS } from "../config/constants.js";
import * as admin from "firebase-admin";

const SENTINEL_MS = new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime();

describe("PLAN-W1: classifyForBackfill", () => {
  it("type=task, status=done with completedAt -> reapable, completedAt + 7d", () => {
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ type: "task", status: "done", completedAt });

    expect(result.branch).toBe("reapable");
    expect(result.ambiguous).toBe(false);
    expect(result.expiresAt.getTime()).toBe(completedAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("type=task, status=cancelled with only createdAt -> reapable, createdAt + 7d", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ type: "task", status: "cancelled", createdAt });

    expect(result.branch).toBe("reapable");
    expect(result.expiresAt.getTime()).toBe(createdAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("type=task, auto_archived=true (regardless of status) -> reapable", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ type: "task", status: "created", auto_archived: true, createdAt });

    expect(result.branch).toBe("reapable");
  });

  it("type=task prefers completedAt over createdAt when both present", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-02-01T00:00:00Z"));
    const result = classifyForBackfill({ type: "task", status: "done", createdAt, completedAt });

    expect(result.expiresAt.getTime()).toBe(completedAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("type=task, open work (status=created, not auto_archived) -> sentinel, not ambiguous", () => {
    const result = classifyForBackfill({ type: "task", status: "created" });

    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(false);
    expect(result.expiresAt.getTime()).toBe(SENTINEL_MS);
  });

  it("type=task, status=active -> sentinel", () => {
    const result = classifyForBackfill({ type: "task", status: "active" });
    expect(result.branch).toBe("sentinel");
  });

  it("no status at all (e.g. sprint/dream) -> sentinel", () => {
    const result = classifyForBackfill({});
    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(false);
  });

  it("NEGATIVE (falsy trap check): terminal branch never reads ttl -- ttl:0 must not influence the branch", () => {
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const withZeroTtl = classifyForBackfill({ type: "task", status: "done", completedAt, ...( { ttl: 0 } as any) });
    const withoutTtl = classifyForBackfill({ type: "task", status: "done", completedAt });

    expect(withZeroTtl).toEqual(withoutTtl);
  });

  it("type=task, terminal (done) with no usable timestamp -> falls back to sentinel AND is flagged ambiguous", () => {
    const result = classifyForBackfill({ type: "task", status: "done" });

    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(true);
    expect(result.expiresAt.getTime()).toBe(SENTINEL_MS);
    expect(result.reason).toBeDefined();
  });

  it("the sentinel value used matches CONSTANTS.ttl.neverExpiresSentinel exactly", () => {
    const result = classifyForBackfill({ type: "task", status: "created" });
    expect(result.expiresAt.toISOString()).toBe(new Date(CONSTANTS.ttl.neverExpiresSentinel).toISOString());
  });

  describe("PLAN-W1 GATE: non-task types always sentinel, ahead of the terminal check", () => {
    it("type=sprint-story, status=done -> sentinel (was reapable before the gate; this IS the 46-doc delta)", () => {
      const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
      const result = classifyForBackfill({ type: "sprint-story", status: "done", completedAt });

      expect(result.branch).toBe("sentinel");
      expect(result.ambiguous).toBe(false);
      expect(result.expiresAt.getTime()).toBe(SENTINEL_MS);
    });

    it("type=sprint, status=done, auto_archived=true -> still sentinel (type gate precedes every terminal signal)", () => {
      const result = classifyForBackfill({ type: "sprint", status: "done", auto_archived: true });
      expect(result.branch).toBe("sentinel");
      expect(result.ambiguous).toBe(false);
    });

    it("type=dream, status=done -> sentinel", () => {
      const result = classifyForBackfill({ type: "dream", status: "done" });
      expect(result.branch).toBe("sentinel");
      expect(result.ambiguous).toBe(false);
    });

    it("type=sprint-story, status=created (already sentinel pre-gate) -> still sentinel, unaffected", () => {
      const result = classifyForBackfill({ type: "sprint-story", status: "created" });
      expect(result.branch).toBe("sentinel");
      expect(result.ambiguous).toBe(false);
    });

    it("type=question, status=cancelled -> sentinel (cancelled is a terminal status the gate still overrides)", () => {
      const result = classifyForBackfill({ type: "question", status: "cancelled" });
      expect(result.branch).toBe("sentinel");
    });

    it("missing type entirely -> sentinel (fail safe: unknown never reaps)", () => {
      const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
      const result = classifyForBackfill({ status: "done", completedAt });
      expect(result.branch).toBe("sentinel");
      expect(result.ambiguous).toBe(false);
    });

    it("a non-task type never reads ttl either (same falsy-trap guarantee as the task path)", () => {
      const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
      const withZeroTtl = classifyForBackfill({ type: "sprint", status: "done", completedAt, ...( { ttl: 0 } as any) });
      const withoutTtl = classifyForBackfill({ type: "sprint", status: "done", completedAt });
      expect(withZeroTtl).toEqual(withoutTtl);
    });
  });
});
