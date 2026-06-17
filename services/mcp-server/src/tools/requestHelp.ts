/**
 * Request Help Tool Registry — LITE profile only.
 * Exposes `request_help` so cerebro tenants can ask the home grid for support.
 * Must NOT appear on the full/home-grid profile (gated in index.ts via IS_LITE).
 */
import { AuthContext } from "../auth/authValidator.js";
import { requestHelpHandler } from "../modules/requestHelp.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  request_help: requestHelpHandler,
};

export const definitions = [
  {
    name: "request_help",
    description:
      "Ask the support team for help. Use when you're stuck or need assistance — they'll be notified and in touch shortly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symptom: {
          type: "string",
          maxLength: 1000,
          description: "What went wrong or why you need help",
        },
        loopId: {
          type: "string",
          maxLength: 200,
          description: "Which feature or loop is affected (optional)",
        },
        context: {
          type: "string",
          maxLength: 500,
          description: "Additional context for the support team (optional)",
        },
      },
      required: ["symptom"],
    },
  },
];
