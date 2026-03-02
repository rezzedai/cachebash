/**
 * Signal Domain Registry — User notification and question tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { askQuestionHandler, getResponseHandler, sendAlertHandler } from "../modules/signal.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  ask_question: askQuestionHandler,
  get_response: getResponseHandler,
  send_alert: sendAlertHandler,
};

export const definitions = [
  {
    name: "ask_question",
    description: "Send a question to the user's mobile device and wait for a response",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", maxLength: 2000 },
        options: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 5 },
        context: { type: "string", maxLength: 500 },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        encrypt: { type: "boolean", default: true },
        threadId: { type: "string" },
        inReplyTo: { type: "string" },
        projectId: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "get_response",
    description: "Check if the user has responded to a question",
    inputSchema: {
      type: "object" as const,
      properties: {
        questionId: { type: "string" },
      },
      required: ["questionId"],
    },
  },
  {
    name: "send_alert",
    description: "Send an alert notification to the user's mobile device (one-way, no response needed)",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", maxLength: 2000 },
        alertType: { type: "string", enum: ["error", "warning", "success", "info"], default: "info" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        context: { type: "string", maxLength: 500 },
        sessionId: { type: "string" },
      },
      required: ["message"],
    },
  },
];
