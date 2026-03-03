/**
 * GSP Module — Grid State Protocol Phase 1 Wave 1.
 *
 * Firestore schema: tenants/{userId}/gsp/{namespace}/entries/{key}
 *
 * Entry fields:
 *   key, namespace, value, tier, schemaVersion, version,
 *   syncedFrom? (constitutional only), createdAt, updatedAt, updatedBy
 *
 * Governance tiers:
 *   - constitutional: read-only via gsp_write; synced from git
 *   - architectural: protected; rejected by gsp_write with redirect
 *   - operational: standard read/write
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

// ── Schema version for all GSP entries ──────────────────────────────────────
const GSP_SCHEMA_VERSION = 1;

// ── Governance tiers ────────────────────────────────────────────────────────
const TIERS = ["constitutional", "architectural", "operational"] as const;
type Tier = typeof TIERS[number];

const PROTECTED_TIERS: readonly Tier[] = ["constitutional", "architectural"];

// ── Zod schemas ─────────────────────────────────────────────────────────────

const GspReadSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(200).optional(),
  tier: z.enum(TIERS).optional(),
  limit: z.number().min(1).max(100).default(50),
});

const GspWriteSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  value: z.unknown(),
  tier: z.enum(TIERS).default("operational"),
  description: z.string().max(500).optional(),
  source: z.string().max(100).optional(),
});

const GspDiffSchema = z.object({
  namespace: z.string().min(1).max(100),
  sinceVersion: z.number().int().min(0).optional(),
  sinceTimestamp: z.string().optional(),
  limit: z.number().min(1).max(200).default(100),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function gspCollectionPath(userId: string, namespace: string): string {
  return `tenants/${userId}/gsp/${namespace}/entries`;
}

// ── gsp_read ────────────────────────────────────────────────────────────────

export async function gspReadHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspReadSchema.parse(rawArgs);
  const db = getFirestore();
  const colPath = gspCollectionPath(auth.userId, args.namespace);

  // Single-key read
  if (args.key) {
    const docRef = db.doc(`${colPath}/${args.key}`);
    const doc = await docRef.get();

    if (!doc.exists) {
      return jsonResult({
        success: true,
        found: false,
        namespace: args.namespace,
        key: args.key,
        message: `No entry found at ${args.namespace}/${args.key}.`,
      });
    }

    const data = doc.data()!;
    return jsonResult({
      success: true,
      found: true,
      entry: { id: doc.id, ...data },
      message: `Entry loaded: ${args.namespace}/${args.key} (v${data.version}).`,
    });
  }

  // Namespace scan (optionally filtered by tier)
  let query: FirebaseFirestore.Query = db.collection(colPath);
  if (args.tier) {
    query = query.where("tier", "==", args.tier);
  }
  query = query.orderBy("updatedAt", "desc").limit(args.limit);

  const snap = await query.get();
  const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResult({
    success: true,
    namespace: args.namespace,
    tier: args.tier || "all",
    entries,
    count: entries.length,
    message: `Found ${entries.length} entries in "${args.namespace}"${args.tier ? ` (tier: ${args.tier})` : ""}.`,
  });
}

// ── gsp_write ───────────────────────────────────────────────────────────────

export async function gspWriteHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspWriteSchema.parse(rawArgs);

  // Governance enforcement: reject constitutional/architectural writes
  if (PROTECTED_TIERS.includes(args.tier as Tier)) {
    return jsonResult({
      success: false,
      error: "GOVERNANCE_VIOLATION",
      tier: args.tier,
      message: `Cannot write to "${args.tier}" tier via gsp_write. `
        + `Use gsp_propose (Phase 2) to request changes to ${args.tier} state. `
        + `Constitutional state is synced from git; architectural state requires governance approval.`,
      hint: "gsp_propose",
    });
  }

  const db = getFirestore();
  const colPath = gspCollectionPath(auth.userId, args.namespace);
  const docRef = db.doc(`${colPath}/${args.key}`);
  const now = new Date().toISOString();

  // Use a Firestore transaction for atomic read-modify-write (shared key safety)
  const result = await db.runTransaction(async (txn) => {
    const existing = await txn.get(docRef);
    const prevVersion = existing.exists ? (existing.data()!.version || 0) : 0;

    // If entry exists, verify it's not a protected tier being overwritten
    if (existing.exists) {
      const existingTier = existing.data()!.tier;
      if (PROTECTED_TIERS.includes(existingTier)) {
        throw new Error(
          `GOVERNANCE_VIOLATION: Existing entry "${args.namespace}/${args.key}" is tier "${existingTier}". `
          + `Cannot overwrite protected state via gsp_write. Use gsp_propose.`
        );
      }
    }

    const newVersion = prevVersion + 1;
    const entry = {
      key: args.key,
      namespace: args.namespace,
      value: args.value,
      tier: args.tier,
      schemaVersion: GSP_SCHEMA_VERSION,
      version: newVersion,
      description: args.description || null,
      updatedAt: now,
      updatedBy: args.source || auth.programId,
      ...(existing.exists ? {} : { createdAt: now }),
    };

    txn.set(docRef, entry, { merge: true });

    return {
      action: existing.exists ? "updated" : "created",
      version: newVersion,
    };
  });

  return jsonResult({
    success: true,
    namespace: args.namespace,
    key: args.key,
    tier: args.tier,
    version: result.version,
    action: result.action,
    message: `Entry ${result.action}: ${args.namespace}/${args.key} (v${result.version}).`,
  });
}

// ── gsp_diff ────────────────────────────────────────────────────────────────

export async function gspDiffHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspDiffSchema.parse(rawArgs);
  const db = getFirestore();
  const colPath = gspCollectionPath(auth.userId, args.namespace);

  let query: FirebaseFirestore.Query = db.collection(colPath);

  if (args.sinceVersion !== undefined) {
    query = query.where("version", ">", args.sinceVersion);
  }

  if (args.sinceTimestamp) {
    query = query.where("updatedAt", ">", args.sinceTimestamp);
  }

  query = query.orderBy("updatedAt", "desc").limit(args.limit);

  const snap = await query.get();
  const changes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResult({
    success: true,
    namespace: args.namespace,
    changes,
    count: changes.length,
    filters: {
      sinceVersion: args.sinceVersion ?? null,
      sinceTimestamp: args.sinceTimestamp ?? null,
    },
    message: `Found ${changes.length} changed entries in "${args.namespace}"${
      args.sinceVersion !== undefined ? ` since v${args.sinceVersion}` : ""
    }${args.sinceTimestamp ? ` since ${args.sinceTimestamp}` : ""}.`,
  });
}

// ── Phase 2 stubs ───────────────────────────────────────────────────────────

export async function gspBootstrapHandler(_auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  console.log("[GSP] gsp_bootstrap called (Phase 2 stub)", JSON.stringify(rawArgs));
  return jsonResult({
    success: false,
    error: "NOT_YET_IMPLEMENTED",
    tool: "gsp_bootstrap",
    message: "gsp_bootstrap is a Phase 2 feature. It will sync constitutional state from git into Firestore.",
  });
}

export async function gspProposeHandler(_auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  console.log("[GSP] gsp_propose called (Phase 2 stub)", JSON.stringify(rawArgs));
  return jsonResult({
    success: false,
    error: "NOT_YET_IMPLEMENTED",
    tool: "gsp_propose",
    message: "gsp_propose is a Phase 2 feature. It will allow proposing changes to constitutional/architectural state.",
  });
}

export async function gspSubscribeHandler(_auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  console.log("[GSP] gsp_subscribe called (Phase 2 stub)", JSON.stringify(rawArgs));
  return jsonResult({
    success: false,
    error: "NOT_YET_IMPLEMENTED",
    tool: "gsp_subscribe",
    message: "gsp_subscribe is a Phase 2 feature. It will allow subscribing to state change notifications.",
  });
}

export async function gspResolveHandler(_auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  console.log("[GSP] gsp_resolve called (Phase 2 stub)", JSON.stringify(rawArgs));
  return jsonResult({
    success: false,
    error: "NOT_YET_IMPLEMENTED",
    tool: "gsp_resolve",
    message: "gsp_resolve is a Phase 2 feature. It will resolve pending governance proposals.",
  });
}
