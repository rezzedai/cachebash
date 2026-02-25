/**
 * Relay Schemas — Zod schemas for structured relay message payloads.
 * Advisory validation: invalid payloads are logged as warnings, message still sent.
 */

import { z } from "zod";

const ResultPayloadSchema = z.object({
  taskId: z.string().optional(),
  outcome: z.enum(["success", "failure", "partial"]).optional(),
  prUrl: z.string().optional(),
  summary: z.string().optional(),
});

const DirectivePayloadSchema = z.object({
  action: z.string().optional(),
  priority: z.string().optional(),
  instructions: z.string().optional(),
  taskId: z.string().optional(),
});

const QueryPayloadSchema = z.object({
  question: z.string().optional(),
  context: z.string().optional(),
  responseFormat: z.string().optional(),
});

const StatusPayloadSchema = z.object({
  state: z.string().optional(),
  progress: z.number().optional(),
  currentTask: z.string().optional(),
  error: z.string().optional(),
});

const HandshakePayloadSchema = z.object({
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

const AckPayloadSchema = z.object({
  messageId: z.string().optional(),
  acknowledged: z.boolean().optional(),
});

const EmptyPayloadSchema = z.object({});

export const RELAY_PAYLOAD_SCHEMAS: Record<string, z.ZodType> = {
  RESULT: ResultPayloadSchema,
  DIRECTIVE: DirectivePayloadSchema,
  QUERY: QueryPayloadSchema,
  STATUS: StatusPayloadSchema,
  HANDSHAKE: HandshakePayloadSchema,
  ACK: AckPayloadSchema,
  PING: EmptyPayloadSchema,
  PONG: EmptyPayloadSchema,
};

export function validatePayload(
  messageType: string,
  payload: unknown
): { valid: boolean; errors?: string[] } {
  const schema = RELAY_PAYLOAD_SCHEMAS[messageType];
  if (!schema) {
    return { valid: false, errors: [`Unknown message type: ${messageType}`] };
  }

  const result = schema.safeParse(payload);
  if (result.success) {
    return { valid: true };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  return { valid: false, errors };
}
