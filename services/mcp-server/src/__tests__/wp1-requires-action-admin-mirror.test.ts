/**
 * WP-1 follow-up (ISO ruling on the review) — the three target:"admin" alert
 * mirrors (wake-daemon.ts, gridbot-monitor.ts, index.ts stale-sessions) were
 * flagged ambiguous in the original WP-1 PR and left at requires_action:
 * true. ISO ruled they must be requires_action: false, same as the
 * target:"user" mirrors: no program is named "admin" so nothing ever claims
 * these rows, and after WP-2's actionable-window filter ships, a true row
 * here would occupy a slot in the dispatcher's 50-row actionable window —
 * the same visibility hazard the user alerts cause today.
 *
 * Drives gridbot-monitor.ts's runHealthCheck (cheaper to set up than
 * wake-daemon.ts's pollAndWake — runHealthCheck takes an injectable `db`
 * directly) and asserts the HEALTH_CRITICAL task mirror it writes has
 * requires_action === false.
 *
 * Fails pre-fix: the mirror is written with requires_action: true.
 */

import { runHealthCheck } from "../modules/gridbot-monitor.js";

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));

describe("WP-1 (ISO ruling): gridbot-monitor.ts admin-target alert mirror", () => {
  it("HEALTH_CRITICAL task mirror has requires_action === false", async () => {
    const writes: Record<string, any[]> = {};
    let getCallCount = 0;

    const fakeDb: any = {
      collection: jest.fn((path: string) => ({
        where: jest.fn().mockReturnThis(),
        get: jest.fn(() => {
          getCallCount++;
          if (getCallCount === 1) {
            // task_failure_rate query: 3/5 failed -> forces overall_status critical
            const docs = [
              { data: () => ({ completed_status: "FAILED" }) },
              { data: () => ({ completed_status: "SUCCESS" }) },
              { data: () => ({ completed_status: "FAILED" }) },
              { data: () => ({ completed_status: "SUCCESS" }) },
              { data: () => ({ completed_status: "FAILED" }) },
            ];
            return Promise.resolve({ size: 5, docs, empty: false });
          }
          return Promise.resolve({ size: 0, docs: [], empty: true });
        }),
        add: jest.fn((data: any) => {
          (writes[path] ||= []).push(data);
          return Promise.resolve({ id: "mock-id" });
        }),
      })),
    };

    const result = await runHealthCheck("test-user", fakeDb);

    expect(result.overall_status).toBe("critical");

    const taskMirror = writes["tenants/test-user/tasks"]?.[0];
    expect(taskMirror).toBeDefined();
    expect(taskMirror.target).toBe("admin");
    expect(taskMirror.requires_action).toBe(false);
  });
});
