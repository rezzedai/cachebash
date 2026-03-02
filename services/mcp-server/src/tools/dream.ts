/**
 * Dream Domain Registry — Dream session tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { dreamPeekHandler, dreamActivateHandler } from "../modules/dream.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  dream_peek: dreamPeekHandler,
  dream_activate: dreamActivateHandler,
};

export const definitions = [
  {
    name: "dream_peek",
    description: "Check for pending dream sessions (lightweight check for shell hooks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "dream_activate",
    description: "Atomically activate a dream session",
    inputSchema: {
      type: "object" as const,
      properties: {
        dreamId: { type: "string" },
      },
      required: ["dreamId"],
    },
  },
];
