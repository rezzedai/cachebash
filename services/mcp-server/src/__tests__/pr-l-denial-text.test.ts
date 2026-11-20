/**
 * RD-5 PR-L, 20.1 item 5 (H9, R12): refusals at the metrics, audit, fleet health, trace, dead-letter, registry and merge handlers
 * name the credentialPrincipal in the returned text. The transport's capability gate answers first on the wire, so the handler text
 * is checked here, with an auth context that carries no capability.
 */
import type { AuthContext } from "../auth/authValidator.js";
import { getCommsMetricsHandler, getCostSummaryHandler, getOperationalMetricsHandler, getCostForecastHandler, getSlaComplianceHandler, getProgramHealthHandler } from "../modules/metrics.js";
import { getAuditHandler } from "../modules/audit.js";
import { getFleetHealthHandler } from "../modules/pulse.js";
import { queryTraceHandler, queryTracesHandler } from "../modules/trace.js";
import { getDeadLettersHandler } from "../modules/relay.js";
import { mergeAccountsHandler } from "../modules/account-merge.js";

jest.mock("../firebase/client.js", () => ({ getFirestore: () => { throw new Error("no firestore before the gate"); }, serverTimestamp: () => "ts" }));

const bare = (principal: string): AuthContext =>
  ({ userId: "u1", programId: principal, keyProgramId: principal, capabilities: [], rateLimitTier: "standard" } as unknown as AuthContext);

const text = (r: { content: Array<{ text: string }> }): string => r.content[0].text;

describe("PR-L denial text names the credentialPrincipal", () => {
  const cases: Array<[string, (a: AuthContext) => Promise<{ content: Array<{ text: string }> }>]> = [
    ["get_comms_metrics", (a) => getCommsMetricsHandler(a, {})],
    ["get_cost_summary", (a) => getCostSummaryHandler(a, {})],
    ["get_operational_metrics", (a) => getOperationalMetricsHandler(a, {})],
    ["get_cost_forecast", (a) => getCostForecastHandler(a, {})],
    ["get_sla_compliance", (a) => getSlaComplianceHandler(a, {})],
    ["get_program_health", (a) => getProgramHealthHandler(a, {})],
    ["get_audit", (a) => getAuditHandler(a, {})],
    ["get_fleet_health", (a) => getFleetHealthHandler(a, {})],
    ["query_trace", (a) => queryTraceHandler(a, { traceId: "t" })],
    ["query_traces", (a) => queryTracesHandler(a, {})],
    ["get_dead_letters", (a) => getDeadLettersHandler(a, {})],
    ["merge_accounts", (a) => mergeAccountsHandler(a, { email: "a@example.invalid", canonicalUid: "u1", alternateUid: "u2" })],
  ];
  test.each(cases)("%s", async (_name, call) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const out = JSON.parse(text(await call(bare("alpha"))));
    expect(out.success).toBe(false);
    expect(out.error).toContain('"alpha"');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"event":"authz_denial"') && String(c[0]).includes('"principal":"alpha"'))).toBe(true);
    warn.mockRestore();
  });
});
