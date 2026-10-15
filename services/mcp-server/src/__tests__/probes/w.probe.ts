import { world } from "./harness/load";
import { callTool, rest, ToolResult } from "./harness/client";
import { writeKey } from "./harness/seed";
import { denied } from "./harness/judge";
import { probe } from "./harness/registry";
import type { World } from "./harness/world";

/**
 * W (A-2): a credential holding only `["*"]` must be denied at each of the 19 wildcard-satisfiable gates
 * (recon section 5). The deny assertion is on `wildcard` (tenant A, program alpha, ["*"]).
 * The allow twin is a credential that is entitled to the same call: `scoped` (holds the literal capability)
 * or the `legacy` seeder (an admin-class program name), so a denial cannot be an empty-database or bad-request artefact.
 */
interface Site {
  id: string;
  gate: string;
  /** wildcard's attempt, and the entitled twin's attempt, in the same request shape */
  attempt: (w: World, who: "wildcard" | "control") => Promise<{ denied: boolean; ok: boolean }>;
}

const viaTool = (tool: string, args: Record<string, unknown>, control: "scoped" | "seeder", transport: "mcp" | "iso" = "mcp") =>
  async (w: World, who: "wildcard" | "control") => {
    const cred = who === "wildcard" ? w.creds.wildcard : control === "scoped" ? w.creds.scoped : w.seeders.A;
    const r: ToolResult = await callTool(w, cred, tool, args, { transport });
    return { denied: denied(r), ok: !denied(r) };
  };

const viaRest = (method: string, path: string, body: unknown, control: "scoped" | "seeder") => async (w: World, who: "wildcard" | "control") => {
  const cred = who === "wildcard" ? w.creds.wildcard : control === "scoped" ? w.creds.scoped : w.seeders.A;
  const r = await rest(w, cred, method, path, body);
  const bad = r.httpStatus >= 400 || r.json?.success === false;
  return { denied: bad, ok: !bad };
};

const SITES: Site[] = [
  { id: "W.01", gate: "index.ts:193 per-tool gate, /v1/mcp", attempt: viaTool("dispatch_get_tasks", { requires_action: null }, "scoped") },
  { id: "W.02", gate: "iso/isoServer.ts:102 per-tool gate, /v1/iso/mcp", attempt: viaTool("dispatch_get_tasks", { requires_action: null }, "scoped", "iso") },
  { id: "W.03", gate: "transport/rest.ts:197 callTool gate, REST", attempt: viaRest("GET", "/v1/tasks", undefined, "scoped") },
  {
    id: "W.04", gate: "transport/rest.ts:301 enforceBreaker gate, REST",
    attempt: async (w, who) => {
      // a real message to mark, so the entitled twin succeeds for the right reason
      const sent = await callTool(w, w.seeders.A, "relay_send_message", { message: "w04", source: "legacy", target: "alpha", message_type: "DIRECTIVE" });
      return viaRest("POST", "/v1/messages/mark_read", { messageIds: [sent.json.messageId] }, "scoped")(w, who);
    },
  },
  { id: "W.05", gate: "middleware/capabilities.ts:318 unmapped tool passes for *", attempt: viaTool("dispatch_reap_expired_tasks", { dryRun: true }, "seeder") },
  { id: "W.07", gate: "modules/audit.ts:25", attempt: viaTool("audit_get_audit", {}, "scoped") },
  { id: "W.08", gate: "modules/metrics.ts:62 comms metrics", attempt: viaTool("metrics_get_comms_metrics", {}, "scoped") },
  { id: "W.09", gate: "modules/metrics.ts:131 cost summary", attempt: viaTool("metrics_get_cost_summary", {}, "scoped") },
  { id: "W.10", gate: "modules/metrics.ts:218 operational metrics", attempt: viaTool("metrics_get_operational_metrics", {}, "scoped") },
  { id: "W.11", gate: "modules/metrics.ts:622 cost forecast", attempt: viaTool("metrics_get_cost_forecast", {}, "scoped") },
  { id: "W.12", gate: "modules/metrics.ts:723 sla compliance", attempt: viaTool("metrics_get_sla_compliance", {}, "scoped") },
  { id: "W.13", gate: "modules/metrics.ts:841 program health", attempt: viaTool("metrics_get_program_health", {}, "scoped") },
  { id: "W.14", gate: "modules/pulse.ts:401 fleet health", attempt: viaTool("pulse_get_fleet_health", { detail: "summary" }, "scoped") },
  { id: "W.15", gate: "transport/rest.ts:131 requireAdmin", attempt: viaRest("GET", "/v1/tasks/stats", undefined, "seeder") },
  { id: "W.17", gate: "dispatch/backfillExpiresAt.ts:61", attempt: viaTool("dispatch_backfill_task_expires_at", { dryRun: true }, "seeder") },
  { id: "W.18", gate: "dispatch/reapExpiredTasks.ts:219", attempt: viaTool("dispatch_reap_expired_tasks", { dryRun: true }, "seeder") },
  { id: "W.19", gate: "gsp.ts:1189 gsp_seed", attempt: viaTool("gsp_seed", { namespace: "w19-probe", entries: [{ key: "k", value: 1, tier: "architectural" }] }, "seeder") },
];

// W.16 (transport/rest.ts:937 POST /admin/reset-program-cache) is not probed: index.ts forwards only /v1/* to the REST router,
// so the route answers 404 for every credential and the gate cannot be reached. Reported to ISO as a finding.
describe("W wildcard-satisfiable gates", () => {
  for (const s of SITES) {
    probe(s.id, async () => {
      const w = world();
      // control first: an entitled credential succeeds with this request shape
      expect({ gate: s.gate, who: "control", ...(await s.attempt(w, "control")) }).toMatchObject({ ok: true });
      // deny: a bare wildcard does not
      expect({ gate: s.gate, who: "wildcard", denied: (await s.attempt(w, "wildcard")).denied }).toEqual({ gate: s.gate, who: "wildcard", denied: true });
    });
  }

  // W.06: the mint ceiling treats a wildcard-holding provisioner as holding every capability.
  probe("W.06", async () => {
    const w = world();
    const mint = async (callerCaps: string[], label: string) => {
      const k = await writeKey(w.tenants.A, "alpha", label, callerCaps);
      return callTool(w, { ...w.creds.wildcard, key: k.key, keyHash: k.keyHash }, "keys_create_key", { programId: "alpha", label: `${label}-child`, capabilities: ["fleet.observe"] });
    };
    // control: a provisioner that literally holds fleet.observe may mint it
    expect((await mint(["keys.provision", "keys.write", "fleet.observe"], "probe-w06-bounded")).json?.success).toBe(true);
    // deny: a provisioner holding "*" must not be able to mint a literal-only capability it does not literally hold
    expect(denied(await mint(["*", "keys.provision", "keys.write"], "probe-w06-star"))).toBe(true);
  });
});
