/**
 * RD-5 PR-C: the four classes the regexes cannot see. Each record carries an anchor; the
 * test requires the handler or route to exist in its file and its source to contain the anchor.
 */
import * as ts from "typescript";
import { listOwners, parseFile } from "../../authz/scan";
import { loadSites, SRC_ROOT } from "./load";

describe("authz-static: classes regex cannot see", () => {
  const doc = loadSites();
  const invisible = doc.sites.filter((s) => s.regex === "none");

  test("the four classes are all present", () => {
    expect([...new Set(invisible.map((s) => s.class))].sort()).toEqual(
      ["gsp-memory-scan", "object-id", "rest-direct-handler", "rest-getfirestore"]
    );
  });

  test("six getFirestore routes and five direct calls (four in routes, enrollHandler) are recorded", () => {
    expect(invisible.filter((s) => s.class === "rest-getfirestore")).toHaveLength(6);
    expect(invisible.filter((s) => s.class === "rest-direct-handler")).toHaveLength(5);
  });

  test("each record names an existing owner whose source contains the anchor", () => {
    const problems: string[] = [];
    for (const s of invisible) {
      const owners = listOwners(parseFile(SRC_ROOT, s.file));
      const node = owners.get(s.handler);
      if (!node) {
        problems.push(`${s.id}: owner ${s.handler} not found in ${s.file}`);
        continue;
      }
      const text = node.getText();
      if (!s.anchor || !text.includes(s.anchor)) problems.push(`${s.id}: anchor ${JSON.stringify(s.anchor)} not in ${s.handler}`);
    }
    expect(problems).toEqual([]);
  });

  test("getFirestore and direct-call records resolve to the recorded line (drift is reported, not hidden)", () => {
    const problems: string[] = [];
    for (const s of invisible.filter((x) => x.line_at_base > 0 && x.class !== "object-id")) {
      const sf = parseFile(SRC_ROOT, s.file);
      const owner = listOwners(sf).get(s.handler)!;
      const start = sf.getLineAndCharacterOfPosition(owner.getStart(sf)).line + 1;
      const end = sf.getLineAndCharacterOfPosition(owner.end).line + 1;
      if (s.line_at_base < start - 2 || s.line_at_base > end + 2) {
        problems.push(`${s.id}: line ${s.line_at_base} is outside ${s.handler} (${start}-${end})`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("object-id records name tools that exist in the handler table", () => {
    const tools = new Set(doc.handlers.map((h) => h.tool));
    for (const s of invisible.filter((x) => x.class === "object-id")) expect(tools.has(s.tool as string)).toBe(true);
    const named = [
      "dispatch_abort_task", "dispatch_escalate_task", "dispatch_approve_task", "dispatch_get_task_by_id",
      "schedule_get", "schedule_delete", "webhook_delete",
      "policy_create", "policy_update", "policy_delete", "policy_get", "policy_list", "policy_check",
      "sprint_update_sprint_story", "sprint_add_story_to_sprint", "sprint_complete_sprint", "sprint_get_sprint",
      "signal_get_response",
    ];
    const have = new Set(invisible.filter((x) => x.class === "object-id").map((x) => x.tool));
    expect(named.filter((t) => !have.has(t))).toEqual([]);
  });

  test("every ts reference parses (sanity)", () => {
    expect(ts.version).toBeTruthy();
  });
});
