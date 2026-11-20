/**
 * Rate Limits Module — Rate limit event stream for telemetry.
 * Collection: tenants/{uid}/rate_limit_events
 *
 * Sessions log throttle events here; admin queries aggregate patterns.
 * TTL: 7 days from timestamp.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { Timestamp, Query } from "firebase-admin/firestore";
import { resolveReadScope } from "../auth/readScope.js";
import { credentialPrincipal } from "../auth/ownerAuthz.js";
import { logDenial } from "../auth/denialLog.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// === Schemas ===

const LogRateLimitEventSchema = z.object({
  sessionId: z.string().max(100),
  modelTier: z.string().max(50),
  endpoint: z.string().max(200),
  backoffMs: z.number().nonnegative(),
  cascaded: z.boolean().default(false),
});

const GetRateLimitEventsSchema = z.object({
  period: z.enum(["today", "this_week", "this_month"]).default("this_month"),
  sessionId: z.string().max(100).optional(),
});

// === Helpers ===

const TTL_DAYS = 7;

function computeTtl(): Timestamp {
  return Timestamp.fromMillis(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
}

function periodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this_week": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case "this_month": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d;
    }
    default:
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

/** Program that owns a session id: "beta" from "beta-s1" or "beta.task". */
const sessionOwner = (sessionId: string): string => sessionId.split(".")[0].split("-")[0];

// === Handlers ===

export async function logRateLimitEventHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = LogRateLimitEventSchema.parse(rawArgs);
  const db = getFirestore();

  const eventData = {
    timestamp: serverTimestamp(),
    sessionId: args.sessionId,
    programId: credentialPrincipal(auth),
    modelTier: args.modelTier,
    endpoint: args.endpoint,
    backoffMs: args.backoffMs,
    cascaded: args.cascaded,
    ttl: computeTtl(),
  };

  const ref = await db.collection(`tenants/${auth.userId}/rate_limit_events`).add(eventData);

  return jsonResult({
    success: true,
    eventId: ref.id,
    message: `Rate limit event logged for session ${args.sessionId}.`,
  });
}

export async function getRateLimitEventsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetRateLimitEventsSchema.parse(rawArgs || {});
  const db = getFirestore();

  // RD-5 PR-L row 27 (L-D1): the subject is the session's owner. With no sessionId the principal sees its own events unless it holds literal fleet.observe.
  const scope = resolveReadScope(auth, args.sessionId ? sessionOwner(args.sessionId) : undefined);
  if (!scope.allowed) {
    logDenial({ principal: scope.principal, tool: "metrics_get_rate_limit_events", subject: scope.filter, code: "FOREIGN_SUBJECT" });
    return jsonResult({ success: false, error: `Access denied: "${scope.principal}" cannot read rate-limit events for session "${args.sessionId}"` });
  }

  const start = periodStart(args.period);
  const startTimestamp = Timestamp.fromDate(start);

  let query: Query = db
    .collection(`tenants/${auth.userId}/rate_limit_events`)
    .where("timestamp", ">=", startTimestamp);

  if (args.sessionId) {
    query = query.where("sessionId", "==", args.sessionId);
  }

  query = query.orderBy("timestamp", "desc");

  const snapshot = await query.get();

  const events = snapshot.docs.filter((doc) => args.sessionId || !scope.filter || doc.data().programId === scope.filter).map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sessionId: data.sessionId,
      programId: data.programId,
      modelTier: data.modelTier,
      endpoint: data.endpoint,
      backoffMs: data.backoffMs,
      cascaded: data.cascaded || false,
      timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
    };
  });

  return jsonResult({
    success: true,
    period: args.period,
    count: events.length,
    events,
    message: events.length > 0
      ? `Found ${events.length} rate limit event(s) for period "${args.period}".`
      : "No rate limit events found for the requested period.",
  });
}
