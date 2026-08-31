import { classifyForBackfill } from "../modules/dispatch/expiresAtBackfillClassifier.js";
import { CONSTANTS } from "../config/constants.js";
import * as admin from "firebase-admin";

const SENTINEL_MS = new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime();

describe("PLAN-W1: classifyForBackfill", () => {
  it("status=done with completedAt -> reapable, completedAt + 7d", () => {
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ status: "done", completedAt });

    expect(result.branch).toBe("reapable");
    expect(result.ambiguous).toBe(false);
    expect(result.expiresAt.getTime()).toBe(completedAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("status=cancelled with only createdAt -> reapable, createdAt + 7d", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ status: "cancelled", createdAt });

    expect(result.branch).toBe("reapable");
    expect(result.expiresAt.getTime()).toBe(createdAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("auto_archived=true (regardless of status) -> reapable", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const result = classifyForBackfill({ status: "created", auto_archived: true, createdAt });

    expect(result.branch).toBe("reapable");
  });

  it("prefers completedAt over createdAt when both present", () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-02-01T00:00:00Z"));
    const result = classifyForBackfill({ status: "done", createdAt, completedAt });

    expect(result.expiresAt.getTime()).toBe(completedAt.toDate().getTime() + 7 * 24 * 3600 * 1000);
  });

  it("open work (status=created, not auto_archived) -> sentinel, not ambiguous", () => {
    const result = classifyForBackfill({ status: "created" });

    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(false);
    expect(result.expiresAt.getTime()).toBe(SENTINEL_MS);
  });

  it("status=active -> sentinel", () => {
    const result = classifyForBackfill({ status: "active" });
    expect(result.branch).toBe("sentinel");
  });

  it("no status at all (e.g. sprint/dream) -> sentinel", () => {
    const result = classifyForBackfill({});
    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(false);
  });

  it("NEGATIVE (falsy trap check): terminal branch never reads ttl -- ttl:0 must not influence the branch", () => {
    const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const withZeroTtl = classifyForBackfill({ status: "done", completedAt, ...( { ttl: 0 } as any) });
    const withoutTtl = classifyForBackfill({ status: "done", completedAt });

    expect(withZeroTtl).toEqual(withoutTtl);
  });

  it("terminal (done) with no usable timestamp -> falls back to sentinel AND is flagged ambiguous", () => {
    const result = classifyForBackfill({ status: "done" });

    expect(result.branch).toBe("sentinel");
    expect(result.ambiguous).toBe(true);
    expect(result.expiresAt.getTime()).toBe(SENTINEL_MS);
    expect(result.reason).toBeDefined();
  });

  it("the sentinel value used matches CONSTANTS.ttl.neverExpiresSentinel exactly", () => {
    const result = classifyForBackfill({ status: "created" });
    expect(result.expiresAt.toISOString()).toBe(new Date(CONSTANTS.ttl.neverExpiresSentinel).toISOString());
  });
});
