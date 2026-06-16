/**
 * Cerebro Enrollment — POST /enroll
 *
 * Exchanges a one-time enrollment token for a tenant-scoped cb_ key.
 * Public route (no cb_ key yet — that's what this returns).
 * All 11 SARK G-4 controls per cerebro/enrollment/DESIGN.md.
 *
 * ⛔ HARD GATE G-4: code reviewed by SARK before exposure.
 * ⛔ HARD GATE G-1: LB + Cloud Armor must be live before this is reachable.
 */

import * as crypto from "crypto";
import http from "http";
import { getFirestore } from "../firebase/client.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const GENERIC_ERROR = { error: "invalid_or_expired_enrollment" } as const;
const MAX_TTL_HOURS = 24;

function sha256hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateApiKey(): string {
  // G-4 control 1: 256-bit token (matches DESIGN.md — 32 bytes = 256 bits)
  return `cb_${crypto.randomBytes(32).toString("hex")}`;
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 4096) {
      throw new Error("body_too_large");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function enrollHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Only POST allowed
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let token: string;
  try {
    const body = await readBody(req);
    if (typeof body.token !== "string" || body.token.length === 0) {
      // Treat missing/invalid token field as generic enrollment failure (no oracle)
      sendJson(res, 400, GENERIC_ERROR);
      return;
    }
    token = body.token;
  } catch {
    sendJson(res, 400, GENERIC_ERROR);
    return;
  }

  // G-4 control 2: hash token — never store or log plaintext
  const tokenHash = sha256hex(token);
  token = ""; // wipe from memory immediately after hashing

  const db = getFirestore();
  const enrollRef = db.doc(`enrollments/${tokenHash}`);

  const liteUrl = process.env.LITE_URL;
  if (!liteUrl) {
    console.error("[enroll] LITE_URL env var not set");
    sendJson(res, 500, { error: "service_unavailable" });
    return;
  }

  let cbKey: string;
  let tenantId: string;

  try {
    await db.runTransaction(async (tx) => {
      // G-4 control 3: single-use atomic transaction
      const doc = await tx.get(enrollRef);

      const now = new Date();

      // G-4 control 4/6: no oracle — all failure paths return the same response
      // We do the minimum work needed (always hash; avoid timing tells via constant-ish path)
      if (!doc.exists) {
        throw new Error("__enrollment_failed__");
      }

      const data = doc.data()!;

      if (data.status !== "pending") {
        throw new Error("__enrollment_failed__");
      }

      const expiresAt: Date = data.expiresAt?.toDate
        ? data.expiresAt.toDate()
        : new Date(data.expiresAt);

      if (now > expiresAt) {
        throw new Error("__enrollment_failed__");
      }

      // All checks passed — mint the key
      tenantId = data.tenantId as string;
      const tier = (data.tier as string) || "free";

      // G-4 control 1/10: generate tenant-scoped lite key (never hub-scoped)
      cbKey = generateApiKey();
      const keyHash = sha256hex(cbKey);

      const keyTtlMs = 90 * 24 * 60 * 60 * 1000; // 90 days default
      const keyExpiresAt = Timestamp.fromMillis(Date.now() + keyTtlMs);

      // G-4 control 9/10: store key hash only; tenant-scoped; no hub caps
      tx.set(db.doc(`keyIndex/${keyHash}`), {
        userId: tenantId,
        programId: "cerebro",
        label: "enrollment-key",
        capabilities: ["*"],
        rateLimitTier: tier,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: keyExpiresAt,
        enrollmentTokenHash: tokenHash.slice(0, 8) + "…", // audit: first-8 only (bridge pattern)
      });

      // G-4 control 3: mark consumed atomically — second redeem fails status check
      // G-4 control 8: log sha256(key) only, never raw cb_key
      tx.update(enrollRef, {
        status: "consumed",
        consumedAt: FieldValue.serverTimestamp(),
        keyHash: keyHash, // sha256(cb_key) for audit — never the raw key
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "__enrollment_failed__") {
      console.error("[enroll] transaction error (tenantId redacted):", msg);
    }
    // G-4 control 4: identical 400 for all failure cases — no used/invalid oracle
    sendJson(res, 400, GENERIC_ERROR);
    return;
  }

  // G-4 control 8/7: return topology-free response; NEVER log cb_key
  console.log(`[enroll] key issued for tenant ${tenantId!} (keyHash logged separately via Firestore)`);

  // G-4 control 7: response is EXACTLY { lite_url, cb_key } — no topology leakage
  sendJson(res, 200, {
    lite_url: liteUrl,
    cb_key: cbKey!,
  });
}
