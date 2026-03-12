/**
 * Usage Domain Registry — Usage tracking and budget management tools.
 * Note: These tools have handlers but no MCP tool definitions (internal/hidden tools).
 */
import { AuthContext } from "../auth/authValidator.js";
import { getUsageHandler, getInvoiceHandler, setBudgetHandler } from "../modules/usage.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  usage_get_usage: getUsageHandler,
  usage_get_invoice: getInvoiceHandler,
  usage_set_budget: setBudgetHandler,
};

export const definitions: Array<{ name: string; description: string; inputSchema: any }> = [];
