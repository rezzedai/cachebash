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
import type { ValidProgramId } from "../config/programs.js";

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

const GspBootstrapSchema = z.object({
  programId: z.string().min(1).max(100),
  depth: z.enum(["essential", "standard", "full"]).default("standard"),
});

interface BootstrapPayload {
  programId: string;
  gspVersion: string;
  generatedAt: string;
  identity: {
    role: string | null;
    groups: string[];
    tags: string[];
    reportingChain: string[];
    capabilities: string[];
  };
  constitutional: {
    hardRules: Array<{ key: string; value: unknown; description?: string }>;
    escalationPolicy: Array<{ key: string; value: unknown; description?: string }>;
    guidingLightDigest: string;
  };
  architectural: {
    activeDecisions: Array<{ key: string; value: unknown; description?: string }>;
    serviceMap: Array<{ key: string; value: unknown; description?: string }>;
    pendingProposals: Array<{ id: string; namespace: string; key: string; status: string }>;
    decisionsOmitted?: number;
  };
  operational: {
    fleetStatus: {
      activeSessions: number;
      recentSessions: Array<{ sessionId: string; programId: string; state: string }>;
    };
    activeSprints: Array<{ key: string; value: unknown; description?: string }>;
    strategicDirection: Array<{ key: string; value: unknown; description?: string }>;
  };
  memory: {
    learnedPatterns: Array<{
      id: string;
      domain: string;
      pattern: string;
      confidence: number;
      evidence: string;
      discoveredAt: string;
    }>;
    contextSummary: {
      lastTask: { taskId: string; title: string; outcome: string; notes: string } | null;
      activeWorkItems: string[];
      handoffNotes: string;
      openQuestions: string[];
    };
  };
  context: {
    pendingTasks: Array<{ id: string; title: string; priority: string; action: string }>;
    unreadMessages: Array<{ id: string; source: string; message_type: string; message: string }>;
  };
}

function buildReportingChain(role: string | null): string[] {
  if (!role) return [];
  
  // Role hierarchy mapping
  const chains: Record<string, string[]> = {
    builder: ["iso", "vector"],
    orchestrator: ["vector"],
    architect: ["vector"],
    auditor: ["vector"],
    reviewer: ["vector"],
    designer: ["vector"],
    growth: ["vector"],
    ops: ["vector"],
    memory: ["vector"],
    strategist: ["vector"],
  };
  
  return chains[role] || [];
}

export async function gspBootstrapHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspBootstrapSchema.parse(rawArgs);
  const depth = args.depth;
  const db = getFirestore();
  const now = new Date().toISOString();

  try {
    // Initialize payload
    const payload: BootstrapPayload = {
      programId: args.programId,
      gspVersion: "1.0",
      generatedAt: now,
      identity: {
        role: null,
        groups: [],
        tags: [],
        reportingChain: [],
        capabilities: [],
      },
      constitutional: {
        hardRules: [],
        escalationPolicy: [],
        guidingLightDigest: "No constitutional state loaded",
      },
      architectural: {
        activeDecisions: [],
        serviceMap: [],
        pendingProposals: [],
      },
      operational: {
        fleetStatus: {
          activeSessions: 0,
          recentSessions: [],
        },
        activeSprints: [],
        strategicDirection: [],
      },
      memory: {
        learnedPatterns: [],
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
      },
      context: {
        pendingTasks: [],
        unreadMessages: [],
      },
    };

    // 1. Identity — Read from program registry
    try {
      const programDoc = await db.doc(`tenants/${auth.userId}/programs/${args.programId}`).get();
      if (programDoc.exists) {
        const programData = programDoc.data()!;
        payload.identity.role = programData.role || null;
        payload.identity.groups = programData.groups || [];
        payload.identity.tags = programData.tags || [];
        payload.identity.reportingChain = buildReportingChain(programData.role);
        
        // Get capabilities from the capabilities module
        const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
        payload.identity.capabilities = programData.capabilities && programData.capabilities.length > 0
          ? programData.capabilities
          : getDefaultCapabilities(args.programId as ValidProgramId);
      }
    } catch (err) {
      console.warn(`[GSP Bootstrap] Failed to load identity for ${args.programId}:`, err);
    }

    // 2. Constitutional — Read from GSP constitutional namespace
    try {
      const constitutionalSnap = await db
        .collection(`tenants/${auth.userId}/gsp/constitution/entries`)
        .where("tier", "==", "constitutional")
        .limit(50)
        .get();

      const hardRules: Array<{ key: string; value: unknown; description?: string }> = [];
      const escalationPolicy: Array<{ key: string; value: unknown; description?: string }> = [];
      let guidingLightContent: string | null = null;
      let sharedExecutionRulesContent: string | null = null;

      constitutionalSnap.docs.forEach((doc) => {
        const data = doc.data();
        const entry = {
          key: data.key,
          value: data.value,
          description: data.description,
        };

        // Handle actual seeded keys
        if (data.key === "guiding-light") {
          guidingLightContent = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
        } else if (data.key === "shared-execution-rules") {
          sharedExecutionRulesContent = typeof data.value === "string" ? data.value : JSON.stringify(data.value);

          // Extract hard rules from shared execution rules
          if (typeof data.value === "object" && data.value !== null) {
            const rulesObj = data.value as any;
            if (rulesObj.hardRules) {
              // If hardRules is an array of objects
              if (Array.isArray(rulesObj.hardRules)) {
                rulesObj.hardRules.forEach((rule: any) => {
                  hardRules.push({
                    key: rule.key || rule.title || "unnamed-rule",
                    value: rule.value || rule.content || rule,
                    description: rule.description,
                  });
                });
              }
              // If hardRules is an object with named rules
              else if (typeof rulesObj.hardRules === "object") {
                Object.entries(rulesObj.hardRules).forEach(([key, value]) => {
                  hardRules.push({ key, value, description: undefined });
                });
              }
            }

            if (rulesObj.escalationPolicy && depth !== "essential") {
              if (Array.isArray(rulesObj.escalationPolicy)) {
                rulesObj.escalationPolicy.forEach((policy: any) => {
                  escalationPolicy.push({
                    key: policy.key || policy.title || "unnamed-policy",
                    value: policy.value || policy.content || policy,
                    description: policy.description,
                  });
                });
              } else if (typeof rulesObj.escalationPolicy === "object") {
                Object.entries(rulesObj.escalationPolicy).forEach(([key, value]) => {
                  escalationPolicy.push({ key, value, description: undefined });
                });
              }
            }
          }
        }
        // Legacy support for prefixed keys (if they exist)
        else if (data.key.startsWith("hardRules")) {
          hardRules.push(entry);
        } else if (data.key.startsWith("escalationPolicy") && depth !== "essential") {
          escalationPolicy.push(entry);
        }
      });

      // Apply depth-based filtering for constitutional content
      if (depth === "essential") {
        // Essential: only core hard rules, truncate to fit ~500 bytes
        payload.constitutional.hardRules = hardRules.slice(0, 3);
        payload.constitutional.escalationPolicy = [];
        const digest = guidingLightContent || "Core constitutional principles loaded";
        payload.constitutional.guidingLightDigest = digest.length > 200 ? digest.substring(0, 200) + "..." : digest;
      } else if (depth === "standard") {
        // Standard: include hard rules and brief guiding light digest
        payload.constitutional.hardRules = hardRules.slice(0, 10);
        payload.constitutional.escalationPolicy = escalationPolicy.slice(0, 5);
        const digest = guidingLightContent || `Loaded ${constitutionalSnap.size} constitutional entries`;
        payload.constitutional.guidingLightDigest = digest.length > 1000 ? digest.substring(0, 1000) + "..." : digest;
      } else {
        // Full: include everything
        payload.constitutional.hardRules = hardRules;
        payload.constitutional.escalationPolicy = escalationPolicy;
        payload.constitutional.guidingLightDigest = guidingLightContent || `Loaded ${constitutionalSnap.size} constitutional entries`;
      }
    } catch (err) {
      console.warn("[GSP Bootstrap] Failed to load constitutional state:", err);
    }

    // 3. Architectural — Read from GSP architecture namespace (skip for essential depth)
    if (depth !== "essential") {
      try {
        const architecturalSnap = await db
          .collection(`tenants/${auth.userId}/gsp/architecture/entries`)
          .where("tier", "==", "architectural")
          .limit(depth === "standard" ? 30 : 100)
          .get();

        const activeDecisions: Array<{ key: string; value: unknown; description?: string }> = [];
        const serviceMap: Array<{ key: string; value: unknown; description?: string }> = [];

        architecturalSnap.docs.forEach((doc) => {
          const data = doc.data();

          // Create entry with depth-aware value truncation
          let entryValue = data.value;
          if (depth === "standard" && typeof entryValue === "string" && entryValue.length > 500) {
            entryValue = entryValue.substring(0, 500) + "...";
          } else if (depth === "standard" && typeof entryValue === "object" && entryValue !== null) {
            // For objects, try to extract summary if available
            const valueObj = entryValue as any;
            if (valueObj.summary) {
              entryValue = valueObj.summary;
            } else if (valueObj.description) {
              entryValue = valueObj.description;
            }
          }

          const entry = {
            key: data.key,
            value: entryValue,
            description: data.description,
          };

          if (data.key.startsWith("decision") || data.key.startsWith("adr-")) {
            activeDecisions.push(entry);
          } else if (data.key.startsWith("service")) {
            serviceMap.push(entry);
          }
        });

        // Apply depth-based limits
        if (depth === "standard") {
          // Standard: Cap decisions at 20, summarize serviceMap
          if (activeDecisions.length > 20) {
            payload.architectural.decisionsOmitted = activeDecisions.length - 20;
            payload.architectural.activeDecisions = activeDecisions.slice(0, 20);
          } else {
            payload.architectural.activeDecisions = activeDecisions;
          }
          payload.architectural.serviceMap = serviceMap.slice(0, 10);
        } else {
          // Full: Include everything
          payload.architectural.activeDecisions = activeDecisions;
          payload.architectural.serviceMap = serviceMap;
        }

        // Check for pending proposals (only for full depth and orchestrators/admin)
        if (depth === "full" && (payload.identity.role === "orchestrator" || payload.identity.role === "admin")) {
          const proposalsSnap = await db
            .collection(`tenants/${auth.userId}/gsp/_proposals`)
            .where("status", "==", "pending")
            .limit(20)
            .get();

          payload.architectural.pendingProposals = proposalsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              namespace: data.namespace || "",
              key: data.key || "",
              status: data.status || "pending",
            };
          });
        }
      } catch (err) {
        console.warn("[GSP Bootstrap] Failed to load architectural state:", err);
      }
    }

    // 4. Operational — Fleet and runtime state
    try {
      // Fleet status from active sessions
      const sessionsSnap = await db
        .collection(`tenants/${auth.userId}/sessions`)
        .where("state", "!=", "complete")
        .orderBy("state")
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

      payload.operational.fleetStatus.activeSessions = sessionsSnap.size;
      payload.operational.fleetStatus.recentSessions = sessionsSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          sessionId: doc.id,
          programId: data.programId || "unknown",
          state: data.state || "unknown",
        };
      });

      // Active sprints from GSP runtime
      const sprintsSnap = await db
        .collection(`tenants/${auth.userId}/gsp/runtime/entries`)
        .where("key", ">=", "sprint")
        .where("key", "<", "sprint\uf8ff")
        .limit(10)
        .get();

      payload.operational.activeSprints = sprintsSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          key: data.key,
          value: data.value,
          description: data.description,
        };
      });

      // Strategic direction from fleet namespace
      const fleetSnap = await db
        .collection(`tenants/${auth.userId}/gsp/fleet/entries`)
        .limit(10)
        .get();

      payload.operational.strategicDirection = fleetSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          key: data.key,
          value: data.value,
          description: data.description,
        };
      });
    } catch (err) {
      console.warn("[GSP Bootstrap] Failed to load operational state:", err);
    }

    // 5. Memory — Program state
    try {
      const stateDoc = await db.doc(`tenants/${auth.userId}/programs/${args.programId}/state`).get();

      if (stateDoc.exists) {
        const stateData = stateDoc.data()!;

        // Learned patterns - apply depth-based limits
        const patterns = stateData.learnedPatterns || [];
        let patternLimit: number;
        if (depth === "essential") {
          patternLimit = 5;
        } else if (depth === "standard") {
          patternLimit = 10;
        } else {
          patternLimit = 20;
        }
        
        payload.memory.learnedPatterns = patterns
          .filter((p: any) => !p.stale)
          .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
          .slice(0, patternLimit)
          .map((p: any) => ({
            id: p.id,
            domain: p.domain,
            pattern: p.pattern,
            confidence: p.confidence,
            evidence: p.evidence,
            discoveredAt: p.discoveredAt,
          }));

        // Context summary (always included, all depths)
        if (stateData.contextSummary) {
          payload.memory.contextSummary = {
            lastTask: stateData.contextSummary.lastTask || null,
            activeWorkItems: stateData.contextSummary.activeWorkItems || [],
            handoffNotes: stateData.contextSummary.handoffNotes || "",
            openQuestions: stateData.contextSummary.openQuestions || [],
          };
        }
      }
    } catch (err) {
      console.warn("[GSP Bootstrap] Failed to load memory state:", err);
    }

    // 6. Context — Pending tasks and unread messages
    try {
      // Determine limits based on depth
      const contextLimit = depth === "essential" ? 10 : 20;
      
      // Pending tasks
      const tasksSnap = await db
        .collection(`tenants/${auth.userId}/tasks`)
        .where("target", "==", args.programId)
        .where("status", "==", "created")
        .orderBy("priority")
        .orderBy("createdAt", "desc")
        .limit(contextLimit)
        .get();

      payload.context.pendingTasks = tasksSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || "",
          priority: data.priority || "normal",
          action: data.action || "queue",
        };
      });

      // Unread messages
      const messagesSnap = await db
        .collection(`tenants/${auth.userId}/relay`)
        .where("target", "==", args.programId)
        .where("status", "==", "pending")
        .orderBy("priority")
        .orderBy("createdAt", "desc")
        .limit(contextLimit)
        .get();

      payload.context.unreadMessages = messagesSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          source: data.source || "",
          message_type: data.message_type || "",
          message: data.message || "",
        };
      });
    } catch (err) {
      console.warn("[GSP Bootstrap] Failed to load context:", err);
    }

    // Depth-based filtering applied inline during data collection

    return jsonResult({
      success: true,
      payload,
      message: `Bootstrap payload generated for ${args.programId}`,
    });
  } catch (error) {
    console.error("[GSP Bootstrap] Error:", error);
    return jsonResult({
      success: false,
      error: "BOOTSTRAP_FAILED",
      message: error instanceof Error ? error.message : "Unknown error during bootstrap",
    });
  }
}

// ── Story 2: gsp_seed implementation ────────────────────────────────────────

const GspSeedSchema = z.object({
  namespace: z.string().min(1).max(100),
  entries: z.array(
    z.object({
      key: z.string().max(200),
      value: z.unknown(),
      tier: z.enum(["constitutional", "architectural"]),
      description: z.string().max(500).optional(),
    })
  ),
  overwrite: z.boolean().default(false),
});

export async function gspSeedHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspSeedSchema.parse(rawArgs);

  // Authorization: admin/orchestrator only
  const authorizedPrograms = ["vector", "iso", "admin", "dispatcher"];
  const hasWildcard = auth.capabilities.includes("*");

  if (!authorizedPrograms.includes(auth.programId) && !hasWildcard) {
    return jsonResult({
      success: false,
      error: "UNAUTHORIZED",
      message: `gsp_seed requires admin/orchestrator role. Current programId: ${auth.programId}`,
    });
  }

  const db = getFirestore();
  const colPath = gspCollectionPath(auth.userId, args.namespace);
  const now = new Date().toISOString();

  try {
    // Use Firestore batch for atomicity
    const batch = db.batch();
    let seeded = 0;
    let skipped = 0;
    const seededKeys: string[] = [];

    for (const entry of args.entries) {
      const docRef = db.doc(`${colPath}/${entry.key}`);

      // Check if entry exists
      const existing = await docRef.get();

      if (existing.exists && !args.overwrite) {
        skipped++;
        continue;
      }

      const prevVersion = existing.exists ? (existing.data()!.version || 0) : 0;
      const newVersion = prevVersion + 1;

      const entryData = {
        key: entry.key,
        namespace: args.namespace,
        value: entry.value,
        tier: entry.tier,
        description: entry.description || null,
        schemaVersion: GSP_SCHEMA_VERSION,
        version: newVersion,
        syncedFrom: {
          source: "seed",
          seededAt: now,
          seededBy: auth.programId,
        },
        createdAt: existing.exists ? existing.data()!.createdAt : now,
        updatedAt: now,
      };

      batch.set(docRef, entryData);
      seeded++;
      seededKeys.push(entry.key);
    }

    await batch.commit();

    return jsonResult({
      success: true,
      seeded,
      skipped,
      entries: seededKeys,
      message: `Seeded ${seeded} entries to ${args.namespace} (${skipped} skipped)`,
    });
  } catch (error) {
    console.error("[GSP Seed] Error:", error);
    return jsonResult({
      success: false,
      error: "SEED_FAILED",
      message: error instanceof Error ? error.message : "Unknown error during seeding",
    });
  }
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
