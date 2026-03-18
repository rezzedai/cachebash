/**
 * Webhook Domain Registry — Task lifecycle webhook notification tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import {
  webhookRegisterHandler,
  webhookListHandler,
  webhookDeleteHandler,
  webhookGetDeliveriesHandler,
} from "../modules/webhook.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  webhook_register: webhookRegisterHandler,
  webhook_list: webhookListHandler,
  webhook_delete: webhookDeleteHandler,
  webhook_get_deliveries: webhookGetDeliveriesHandler,
};

export const definitions = [
  {
    name: "webhook_register",
    description: "Register a webhook for task lifecycle events: {events, callbackUrl, secret, filter}",
    inputSchema: {
      type: "object" as const,
      properties: {
        events: {
          type: "array",
          items: {
            type: "string",
            enum: ["task.created", "task.claimed", "task.completed", "task.failed", "task.retried", "task.aborted"],
          },
          minItems: 1,
          description: "Task lifecycle events to subscribe to",
        },
        callbackUrl: {
          type: "string",
          maxLength: 500,
          description: "HTTPS URL to receive webhook POST requests",
        },
        secret: {
          type: "string",
          maxLength: 200,
          description: "Optional HMAC-SHA256 signing secret. If provided, each delivery includes X-Webhook-Signature header.",
        },
        filter: {
          type: "object",
          description: "Optional filter to narrow which tasks trigger this webhook",
          properties: {
            target: {
              type: "string",
              maxLength: 100,
              description: "Only fire for tasks targeting this program",
            },
            source: {
              type: "string",
              maxLength: 100,
              description: "Only fire for tasks from this source",
            },
            projectId: {
              type: "string",
              maxLength: 100,
              description: "Only fire for tasks in this project",
            },
          },
        },
      },
      required: ["events", "callbackUrl"],
    },
  },
  {
    name: "webhook_list",
    description: "List webhook registrations (filterable by enabled status)",
    inputSchema: {
      type: "object" as const,
      properties: {
        enabled: {
          type: "boolean",
          description: "Filter by enabled status (omit for all)",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50,
          default: 20,
        },
      },
    },
  },
  {
    name: "webhook_delete",
    description: "Remove a webhook registration",
    inputSchema: {
      type: "object" as const,
      properties: {
        webhookId: {
          type: "string",
          description: "Webhook registration ID to delete",
        },
      },
      required: ["webhookId"],
    },
  },
  {
    name: "webhook_get_deliveries",
    description: "Get webhook delivery logs (filterable by webhookId, status)",
    inputSchema: {
      type: "object" as const,
      properties: {
        webhookId: {
          type: "string",
          description: "Filter deliveries for a specific webhook (optional)",
        },
        status: {
          type: "string",
          enum: ["success", "failed"],
          description: "Filter by delivery status (optional)",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
    },
  },
];
