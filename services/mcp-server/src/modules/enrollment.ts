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
import { WINGMAN_TIER_CAPABILITIES } from "../middleware/capabilities.js";

const GENERIC_ERROR = { error: "invalid_or_expired_enrollment" } as const;

// F-368-2: hard cap enforced at REDEEM — even if the provisioner stored a longer expiresAt.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

// F-368-3: tier-scoped capabilities for lite profile keys (Trial/Standard/Dedicated).
// "dedicated" is the only tier that grants wildcard access.
const LITE_TIER_CAPABILITIES: Record<string, string[]> = {
  trial: [
    "dispatch.read", "dispatch.write",
    "relay.read", "relay.write",
    "pulse.read", "pulse.write",
    "gsp.read",
    "state.read", "state.write",
    "audit.read",
  ],
  standard: [
    "dispatch.read", "dispatch.write",
    "relay.read", "relay.write",
    "pulse.read", "pulse.write",
    "signal.read", "signal.write",
    "sprint.read", "sprint.write",
    "keys.read",
    "programs.read",
    "gsp.read", "gsp.write",
    "state.read", "state.write",
    "audit.read",
    "metrics.read",
    "fleet.read",
    "trace.read",
  ],
  dedicated: ["*"],
};

function tierCapabilities(tier: string): string[] {
  // WS-2: "wingman" resolves to the canonical wingman preset in capabilities.ts —
  // SINGLE SOURCE OF TRUTH, never duplicated here (drift = security bug).
  if (tier.toLowerCase() === "wingman") return WINGMAN_TIER_CAPABILITIES;
  return LITE_TIER_CAPABILITIES[tier.toLowerCase()] ?? LITE_TIER_CAPABILITIES["standard"];
}

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

      // G-4 control 4/6: no oracle — all failure paths throw the same sentinel
      if (!doc.exists) {
        throw new Error("__enrollment_failed__");
      }

      const data = doc.data()!;

      if (data.status !== "pending") {
        throw new Error("__enrollment_failed__");
      }

      const storedExpiresAt: Date = data.expiresAt?.toDate
        ? data.expiresAt.toDate()
        : new Date(data.expiresAt);

      // F-368-2: enforce MAX_TTL_MS hard cap at redeem.
      // Compute effective expiry as min(storedExpiresAt, createdAt + 24h).
      // This caps even provisioner-issued tokens that exceed the 24h limit.
      const createdAt: Date = data.createdAt?.toDate
        ? data.createdAt.toDate()
        : data.createdAt instanceof Date
          ? data.createdAt
          : new Date(data.createdAt ?? now);
      const maxAllowedExpiry = new Date(createdAt.getTime() + MAX_TTL_MS);
      const effectiveExpiry = storedExpiresAt < maxAllowedExpiry ? storedExpiresAt : maxAllowedExpiry;

      if (now > effectiveExpiry) {
        throw new Error("__enrollment_failed__");
      }

      // All checks passed — mint the key
      tenantId = data.tenantId as string;
      const tier = (data.tier as string) || "standard";
      // WS-2: wingman enrollment docs carry a seatId — stamped onto the minted
      // key so per-seat metering (usage.ts) can attribute calls to the seat.
      const seatId = typeof data.seatId === "string" ? data.seatId : undefined;

      // G-4 control 1/10: generate tenant-scoped lite key (never hub-scoped)
      cbKey = generateApiKey();
      const keyHash = sha256hex(cbKey);

      const keyTtlMs = 90 * 24 * 60 * 60 * 1000;
      const keyExpiresAt = Timestamp.fromMillis(Date.now() + keyTtlMs);

      // F-368-3: tier-scoped capabilities; G-4 control 9/10: tenant-scoped, no hub caps
      tx.set(db.doc(`keyIndex/${keyHash}`), {
        userId: tenantId,
        programId: "cerebro",
        label: "enrollment-key",
        capabilities: tierCapabilities(tier),
        rateLimitTier: tier,
        tier,
        ...(seatId ? { seatId } : {}),
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: keyExpiresAt,
        enrollmentTokenHash: tokenHash.slice(0, 8) + "…", // audit: first-8 only
      });

      // G-4 control 3: atomic consume; G-4 control 8: sha256(key) for audit, never raw
      tx.update(enrollRef, {
        status: "consumed",
        consumedAt: FieldValue.serverTimestamp(),
        keyHash: keyHash,
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "__enrollment_failed__") {
      console.error("[enroll] transaction error (tenantId redacted):", msg);
    }
    // G-4 control 4: identical 400 for all failure cases — no oracle
    sendJson(res, 400, GENERIC_ERROR);
    return;
  }

  // G-4 control 8/7: NEVER log raw key; response is topology-free
  console.log(`[enroll] key issued for tenant ${tenantId!} (keyHash in Firestore)`);

  // G-4 control 7: response EXACTLY { lite_url, cb_key }
  sendJson(res, 200, {
    lite_url: liteUrl,
    cb_key: cbKey!,
  });
}
