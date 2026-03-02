/**
 * Usage Domain Registry — Usage tracking and budget management tools.
 * Note: These tools have handlers but no MCP tool definitions (internal/hidden tools).
 */
import { AuthContext } from "../auth/authValidator.js";
import { getUsageHandler, getInvoiceHandler, setBudgetHandler } from "../modules/usage.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  get_usage: getUsageHandler,
  get_invoice: getInvoiceHandler,
  set_budget: setBudgetHandler,
};

export const definitions: Array<{ name: string; description: string; inputSchema: any }> = [];
