/**
 * Audit Domain Registry — Audit log and compliance tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getAuditHandler } from "../modules/audit.js";
import { getAckComplianceHandler } from "../modules/ack-compliance.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  get_audit: getAuditHandler,
  get_ack_compliance: getAckComplianceHandler,
};

export const definitions = [
  {
    name: "get_audit",
    description: "Query the Gate audit log. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", minimum: 1, maximum: 100, default: 50, description: "Max results" },
        allowed: { type: "boolean", description: "Filter by allowed (true) or denied (false)" },
        programId: { type: "string", maxLength: 100, description: "Filter by program ID" },
      },
    },
  },
  {
    name: "get_ack_compliance",
    description: "Get ACK compliance report. Returns statistics on DIRECTIVE messages and their ACK status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Filter by source program ID" },
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to query" },
      },
    },
  },
];
