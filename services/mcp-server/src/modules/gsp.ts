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


// ── Subscription Notification Helper ───────────────────────────────────────

/**
 * notifySubscribers — Send notifications to all active subscribers for a state change
 * 
 * @param auth - Auth context for sending messages
 * @param namespace - GSP namespace that changed
 * @param key - GSP key that changed
 * @param version - New version number
 * @param changedBy - Program ID or source that made the change
 */
async function notifySubscribers(
  auth: AuthContext,
  namespace: string,
  key: string,
  version: number,
  changedBy: string
): Promise<void> {
  const db = getFirestore();
  const subscriptionsPath = `tenants/${auth.userId}/gsp_subscriptions`;
  const now = new Date().toISOString();

  try {
    // Query for active subscriptions matching this change
    // 1. Exact match: namespace + key
    // 2. Namespace-wide: namespace + null key
    const exactMatchQuery = db.collection(subscriptionsPath)
      .where("namespace", "==", namespace)
      .where("key", "==", key)
      .where("active", "==", true);

    const namespaceWideQuery = db.collection(subscriptionsPath)
      .where("namespace", "==", namespace)
      .where("key", "==", null)
      .where("active", "==", true);

    const [exactMatches, namespaceWide] = await Promise.all([
      exactMatchQuery.get(),
      namespaceWideQuery.get(),
    ]);

    // Combine results
    const allSubscriptions = [...exactMatches.docs, ...namespaceWide.docs];

    if (allSubscriptions.length === 0) {
      return; // No subscribers to notify
    }

    // Fetch current state value for webhook payloads
    const colPath = gspCollectionPath(auth.userId, namespace);
    const docRef = db.doc(`${colPath}/${key}`);
    const currentDoc = await docRef.get();
    const currentValue = currentDoc.exists ? currentDoc.data()!.value : null;

    // Import dependencies
    const { sendMessageHandler } = await import("./relay.js");
    const { dispatchWebhook } = await import("./webhookDispatcher.js");

    // Send notification to each subscriber
    for (const subDoc of allSubscriptions) {
      const subscription = subDoc.data();

      // Dedup check: skip if already notified of this version or later
      if (subscription.lastNotifiedVersion && subscription.lastNotifiedVersion >= version) {
        continue;
      }

      try {
        // Route based on callback type
        if (subscription.callbackType === "webhook") {
          // Webhook notification
          const webhookEvent = {
            event: "state_change" as const,
            namespace,
            key,
            value: currentValue,
            version,
            updatedAt: now,
            updatedBy: changedBy,
          };

          const webhookSub = {
            id: subscription.id,
            callbackUrl: subscription.callbackUrl,
            secret: subscription.secret,
            programId: subscription.programId,
            namespace: subscription.namespace,
            key: subscription.key,
          };

          // Fire webhook asynchronously (don't await - fire-and-forget)
          dispatchWebhook(webhookSub, webhookEvent, auth.userId).catch(error => {
            console.error(`[GSP Notify] Webhook dispatch failed for ${subscription.id}:`, error);
          });

        } else {
          // Message-based notification (original behavior)
          const messageArgs = {
            source: "gsp",
            target: subscription.programId,
            message_type: "RESULT" as const,
            message: `[GSP_CHANGE] ${namespace}/${key} v${version} changed by ${changedBy} at ${now}. Use gsp_read() to fetch current value.`,
            priority: "normal" as const,
            action: "queue" as const,
          };

          await sendMessageHandler(auth, messageArgs);
        }

        // Update subscription with notification tracking
        await subDoc.ref.update({
          lastNotifiedAt: now,
          lastNotifiedVersion: version,
        });

      } catch (error) {
        console.error(`[GSP Notify] Failed to notify subscriber ${subscription.programId}:`, error);
        // Fire-and-forget: don't fail the state change if notification fails
      }
    }
  } catch (error) {
    console.error(`[GSP Notify] Error in notifySubscribers for ${namespace}/${key}:`, error);
    // Fire-and-forget: don't propagate errors
  }
}

// ── notifyProposalSubscribers ──────────────────────────────────────────────

/**
 * notifyProposalSubscribers — Send proposal lifecycle notifications to subscribers
 * 
 * @param auth - Auth context for sending messages
 * @param namespace - GSP namespace of the proposal
 * @param key - GSP key of the proposal
 * @param message - Notification message to send
 */
async function notifyProposalSubscribers(
  auth: AuthContext,
  namespace: string,
  key: string,
  message: string
): Promise<void> {
  const db = getFirestore();
  const subscriptionsPath = `tenants/${auth.userId}/gsp_subscriptions`;

  try {
    // Query for active subscriptions matching this proposal's target
    // 1. Exact match: namespace + key
    // 2. Namespace-wide: namespace + null key
    const exactMatchQuery = db.collection(subscriptionsPath)
      .where("namespace", "==", namespace)
      .where("key", "==", key)
      .where("active", "==", true);

    const namespaceWideQuery = db.collection(subscriptionsPath)
      .where("namespace", "==", namespace)
      .where("key", "==", null)
      .where("active", "==", true);

    const [exactMatches, namespaceWide] = await Promise.all([
      exactMatchQuery.get(),
      namespaceWideQuery.get(),
    ]);

    // Combine results
    const allSubscriptions = [...exactMatches.docs, ...namespaceWide.docs];

    if (allSubscriptions.length === 0) {
      return; // No subscribers to notify
    }

    // Import sendMessageHandler
    const { sendMessageHandler } = await import("./relay.js");

    // Send notification to each subscriber
    for (const subDoc of allSubscriptions) {
      const subscription = subDoc.data();

      const messageArgs = {
        source: "gsp",
        target: subscription.programId,
        message_type: "RESULT" as const,
        message,
        priority: "normal" as const,
        action: "queue" as const,
      };

      try {
        await sendMessageHandler(auth, messageArgs);
      } catch (error) {
        console.error(`[GSP Proposal Notify] Failed to notify subscriber ${subscription.programId}:`, error);
        // Fire-and-forget: don't fail the proposal operation if notification fails
      }
    }
  } catch (error) {
    console.error(`[GSP Proposal Notify] Error in notifyProposalSubscribers for ${namespace}/${key}:`, error);
    // Fire-and-forget: don't propagate errors
  }
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


  // Notify subscribers of state change
  await notifySubscribers(auth, args.namespace, args.key, result.version, args.source || auth.programId);

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
  agentId: z.string().min(1).max(100),
  depth: z.enum(["essential", "standard", "full"]).default("standard"),
});

interface BootstrapPayload {
  agentId: string;
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
      agentId: args.agentId,
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
      const programDoc = await db.doc(`tenants/${auth.userId}/programs/${args.agentId}`).get();
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
          : getDefaultCapabilities(args.agentId as ValidProgramId);
      }
    } catch (err) {
      console.warn(`[GSP Bootstrap] Failed to load identity for ${args.agentId}:`, err);
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
            .collection(`tenants/${auth.userId}/gsp_proposals`)
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
      const stateDoc = await db.doc(`tenants/${auth.userId}/programs/${args.agentId}/state`).get();

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
        .where("target", "==", args.agentId)
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
        .where("target", "==", args.agentId)
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
      message: `Bootstrap payload generated for ${args.agentId}`,
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


// ── Story GSP-9a: gsp_propose implementation ────────────────────────────────

const GspProposeSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  proposedValue: z.unknown(),
  rationale: z.string().min(1).max(1000),
  evidence: z.string().max(2000).optional(),
});

const GspResolveSchema = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(["approved", "rejected", "withdrawn"]),
  reasoning: z.string().max(1000).optional(),
});

const GspSubscribeSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(200).optional(),
  callbackType: z.enum(["message", "webhook"]).optional().default("message"),
  callbackUrl: z.string().max(500).url().optional(),
  secret: z.string().max(200).optional(),
  unsubscribe: z.boolean().optional().default(false),
}).refine(
  (data) => {
    // If callbackType is webhook, callbackUrl is required
    if (data.callbackType === "webhook" && !data.callbackUrl) {
      return false;
    }
    return true;
  },
  {
    message: "callbackUrl is required when callbackType is 'webhook'",
    path: ["callbackUrl"],
  }
);


export async function gspProposeHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspProposeSchema.parse(rawArgs);
  const db = getFirestore();
  const now = new Date().toISOString();

  try {
    // Step 1: Validate namespace/key and determine tier
    const colPath = gspCollectionPath(auth.userId, args.namespace);
    const docRef = db.doc(`${colPath}/${args.key}`);
    const currentDoc = await docRef.get();

    let tier: Tier;
    let currentValue: unknown = null;

    if (currentDoc.exists) {
      // Key exists - get tier from existing entry
      const data = currentDoc.data()!;
      tier = data.tier as Tier;
      currentValue = data.value;
    } else {
      // Key doesn't exist - check if namespace has any entries to infer tier
      const namespaceSnap = await db.collection(colPath).limit(1).get();
      
      if (namespaceSnap.empty) {
        return jsonResult({
          success: false,
          error: "NAMESPACE_NOT_FOUND",
          message: `Namespace "${args.namespace}" does not exist or is empty. Cannot propose changes to non-existent namespace.`,
        });
      }
      
      // Infer tier from first entry in namespace
      tier = namespaceSnap.docs[0].data().tier as Tier;
    }

    // Validate tier is constitutional or architectural
    if (tier === "operational") {
      return jsonResult({
        success: false,
        error: "GOVERNANCE_VIOLATION",
        message: `Cannot propose changes to operational tier. Use gsp_write instead.`,
      });
    }

    // Step 2: Check proposer's pending proposal quota (max 5)
    const proposalsRef = db.collection(`tenants/${auth.userId}/gsp_proposals`);
    const pendingQuery = proposalsRef
      .where("proposedBy", "==", auth.programId)
      .where("status", "==", "pending");
    
    const pendingSnap = await pendingQuery.get();
    if (pendingSnap.size >= 5) {
      return jsonResult({
        success: false,
        error: "QUOTA_EXCEEDED",
        message: `Proposal quota exceeded. Program "${auth.programId}" has ${pendingSnap.size} pending proposals (max 5).`,
      });
    }

    // Step 3: Check for duplicate proposals
    const duplicateQuery = proposalsRef
      .where("namespace", "==", args.namespace)
      .where("key", "==", args.key)
      .where("proposedBy", "==", auth.programId)
      .where("status", "==", "pending");
    
    const duplicateSnap = await duplicateQuery.get();
    if (!duplicateSnap.empty) {
      const existingProposalId = duplicateSnap.docs[0].id;
      return jsonResult({
        success: false,
        error: "DUPLICATE_PROPOSAL",
        message: `A pending proposal already exists for ${args.namespace}/${args.key} by ${auth.programId}. Proposal ID: ${existingProposalId}`,
      });
    }

    // Step 4: Auto-assign reviewers based on tier
    const reviewers = tier === "constitutional" ? ["flynn"] : ["vector"];

    // Step 5: Set TTL (30 days from now)
    const createdAt = now;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Step 6: Write proposal to Firestore
    const proposalRef = proposalsRef.doc();
    const proposalId = proposalRef.id;

    const proposal = {
      id: proposalId,
      namespace: args.namespace,
      key: args.key,
      currentValue,
      proposedValue: args.proposedValue,
      rationale: args.rationale,
      evidence: args.evidence || null,
      proposedBy: auth.programId,
      status: "pending",
      reviewers,
      createdAt,
      expiresAt,
      version: 1,
    };

    await proposalRef.set(proposal);

    // Step 7: Send notification to each reviewer via send_message
    const { sendMessageHandler } = await import("./relay.js");

    for (const reviewer of reviewers) {
      const messageArgs = {
        source: "gsp",
        target: reviewer,
        message_type: "DIRECTIVE" as const,
        message: `[GSP] New proposal: ${args.namespace}/${args.key} by ${auth.programId}. Rationale: ${args.rationale}. Use gsp_resolve(proposalId: '${proposalId}') to review.`,
        priority: "normal" as const,
        action: "queue" as const,
      };

      try {
        await sendMessageHandler(auth, messageArgs);
      } catch (error) {
        console.error(`[GSP Propose] Failed to notify reviewer ${reviewer}:`, error);
        // Don't fail the proposal if notification fails
      }
    }

    // Step 7b: Notify subscribers of proposal creation
    const proposalCreationMessage = `[GSP_PROPOSAL] New proposal for ${args.namespace}/${args.key} by ${auth.programId}: ${args.rationale}. ProposalId: ${proposalId}. Status: pending.`;
    await notifyProposalSubscribers(auth, args.namespace, args.key, proposalCreationMessage);

    // Step 8: Return success
    return jsonResult({
      success: true,
      proposalId,
      status: "pending",
      reviewers,
      expiresAt,
      message: `Proposal created for ${tier} state: ${args.namespace}/${args.key}. Reviewers: ${reviewers.join(", ")}. Expires: ${expiresAt}`,
    });

  } catch (error) {
    console.error("[GSP Propose] Error:", error);
    return jsonResult({
      success: false,
      error: "PROPOSE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error during proposal creation",
    });
  }
}

export async function gspSubscribeHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspSubscribeSchema.parse(rawArgs);
  const db = getFirestore();
  const now = new Date().toISOString();

  try {
    // Step 1: Validate namespace exists
    const colPath = gspCollectionPath(auth.userId, args.namespace);
    const namespaceSnap = await db.collection(colPath).limit(1).get();

    if (namespaceSnap.empty) {
      return jsonResult({
        success: false,
        error: "NAMESPACE_NOT_FOUND",
        namespace: args.namespace,
        message: `Namespace "${args.namespace}" does not exist. Cannot subscribe to non-existent namespace.`,
      });
    }

    // Step 2: Get subscriber identity
    const programId = auth.programId;

    // Step 3: If unsubscribe === true, deactivate subscription
    if (args.unsubscribe) {
      const subsRef = db.collection(`tenants/${auth.userId}/gsp_subscriptions`);
      const query = subsRef
        .where("programId", "==", programId)
        .where("namespace", "==", args.namespace)
        .where("key", "==", args.key ?? null)
        .where("active", "==", true)
        .limit(1);

      const existingSubs = await query.get();

      if (existingSubs.empty) {
        return jsonResult({
          success: false,
          error: "SUBSCRIPTION_NOT_FOUND",
          programId,
          namespace: args.namespace,
          key: args.key ?? null,
          message: `No active subscription found for ${programId} on ${args.namespace}${args.key ? `/${args.key}` : ""}`,
        });
      }

      const subDoc = existingSubs.docs[0];
      await subDoc.ref.update({ active: false, updatedAt: now });

      return jsonResult({
        success: true,
        action: "unsubscribed",
        subscriptionId: subDoc.id,
        programId,
        namespace: args.namespace,
        key: args.key ?? null,
      });
    }

    // Step 4: Check for duplicate subscription
    const subsRef = db.collection(`tenants/${auth.userId}/gsp_subscriptions`);
    const duplicateQuery = subsRef
      .where("programId", "==", programId)
      .where("namespace", "==", args.namespace)
      .where("key", "==", args.key ?? null)
      .where("active", "==", true)
      .limit(1);

    const duplicates = await duplicateQuery.get();

    if (!duplicates.empty) {
      return jsonResult({
        success: false,
        error: "DUPLICATE_SUBSCRIPTION",
        existingSubscriptionId: duplicates.docs[0].id,
        programId,
        namespace: args.namespace,
        key: args.key ?? null,
        message: `Subscription already exists for ${programId} on ${args.namespace}${args.key ? `/${args.key}` : ""}`,
      });
    }

    // Step 5: Write subscription to Firestore
    const newSubRef = subsRef.doc(); // Auto-generate ID
    const subscription: any = {
      id: newSubRef.id,
      programId,
      namespace: args.namespace,
      key: args.key ?? null,
      callbackType: args.callbackType ?? "message",
      createdAt: now,
      lastNotifiedAt: null,
      lastNotifiedVersion: null,
      active: true,
    };

    // Add webhook-specific fields if callbackType is webhook
    if (args.callbackType === "webhook") {
      subscription.callbackUrl = args.callbackUrl;
      if (args.secret) {
        subscription.secret = args.secret; // Store plaintext for now; encrypt in production
      }
    }

    await newSubRef.set(subscription);

    // Step 6: Return success
    return jsonResult({
      success: true,
      subscriptionId: newSubRef.id,
      programId,
      namespace: args.namespace,
      key: args.key ?? null,
      callbackType: args.callbackType ?? "message",
      callbackUrl: args.callbackType === "webhook" ? args.callbackUrl : undefined,
      message: args.callbackType === "webhook" 
        ? `Subscribed to ${args.namespace}${args.key ? `/${args.key}` : ""} — webhooks will be POSTed to ${args.callbackUrl} on state changes.`
        : `Subscribed to ${args.namespace}${args.key ? `/${args.key}` : ""} — will receive send_message callbacks on state changes.`,
    });
  } catch (error: unknown) {
    console.error("[GSP] gsp_subscribe error:", error);
    return jsonResult({
      success: false,
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error during subscription",
    });
  }
}

export async function gspResolveHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GspResolveSchema.parse(rawArgs);
  const db = getFirestore();
  const now = new Date().toISOString();

  try {
    // Step 1: Load proposal by ID
    const proposalRef = db.doc(`tenants/${auth.userId}/gsp_proposals/${args.proposalId}`);
    const proposalDoc = await proposalRef.get();

    if (!proposalDoc.exists) {
      return jsonResult({
        success: false,
        error: "PROPOSAL_NOT_FOUND",
        proposalId: args.proposalId,
        message: `Proposal ${args.proposalId} not found.`,
      });
    }

    const proposal = proposalDoc.data()!;

    // Step 2: Check proposal status
    if (proposal.status !== "pending") {
      return jsonResult({
        success: false,
        error: "PROPOSAL_ALREADY_RESOLVED",
        proposalId: args.proposalId,
        currentStatus: proposal.status,
        message: `Proposal ${args.proposalId} already resolved with status: ${proposal.status}`,
      });
    }

    // Step 3: Check expiration
    if (new Date(proposal.expiresAt) < new Date()) {
      // Auto-expire the proposal
      await proposalRef.update({
        status: "expired",
        resolvedAt: now,
        version: proposal.version + 1,
      });

      return jsonResult({
        success: false,
        error: "PROPOSAL_EXPIRED",
        proposalId: args.proposalId,
        expiresAt: proposal.expiresAt,
        message: `Proposal ${args.proposalId} expired at ${proposal.expiresAt}`,
      });
    }

    // Step 4: Validate resolver authorization
    if (args.decision === "withdrawn") {
      // Only the proposer can withdraw
      if (auth.programId !== proposal.proposedBy) {
        return jsonResult({
          success: false,
          error: "UNAUTHORIZED",
          proposalId: args.proposalId,
          message: `Only the proposer (${proposal.proposedBy}) can withdraw this proposal. You are: ${auth.programId}`,
        });
      }
    } else {
      // approved or rejected - only reviewers can resolve
      if (!proposal.reviewers.includes(auth.programId)) {
        return jsonResult({
          success: false,
          error: "UNAUTHORIZED",
          proposalId: args.proposalId,
          reviewers: proposal.reviewers,
          message: `Only assigned reviewers can approve/reject. Reviewers: ${proposal.reviewers.join(", ")}. You are: ${auth.programId}`,
        });
      }
    }

    // Step 5: If approved, apply state change atomically with proposal update
    let stateUpdated = false;
    let newVersionApplied = 0;
    
    if (args.decision === "approved") {
      await db.runTransaction(async (txn) => {
        // Apply the state change
        const colPath = gspCollectionPath(auth.userId, proposal.namespace);
        const stateDocRef = db.doc(`${colPath}/${proposal.key}`);
        const existingState = await txn.get(stateDocRef);
        const prevVersion = existingState.exists ? (existingState.data()!.version || 0) : 0;
        const newVersion = prevVersion + 1;
        newVersionApplied = newVersion;

        // Get tier from existing entry or infer from namespace
        let tier: Tier;
        if (existingState.exists) {
          tier = existingState.data()!.tier as Tier;
        } else {
          // Infer tier from namespace (we validated this during proposal creation)
          const namespaceSnap = await db.collection(colPath).limit(1).get();
          tier = namespaceSnap.empty ? "operational" : (namespaceSnap.docs[0].data().tier as Tier);
        }

        const stateEntry = {
          key: proposal.key,
          namespace: proposal.namespace,
          value: proposal.proposedValue,
          tier,
          schemaVersion: GSP_SCHEMA_VERSION,
          version: newVersion,
          description: `Applied from proposal ${args.proposalId}`,
          updatedAt: now,
          updatedBy: `gsp:proposal:${args.proposalId}`,
          ...(existingState.exists ? {} : { createdAt: now }),
        };

        txn.set(stateDocRef, stateEntry, { merge: true });

        // Update the proposal document
        txn.update(proposalRef, {
          status: args.decision,
          resolvedBy: auth.programId,
          resolvedAt: now,
          resolution: args.reasoning || "",
          version: proposal.version + 1,
        });
      });

      stateUpdated = true;
    } else {
      // For rejected or withdrawn, just update the proposal
      await proposalRef.update({
        status: args.decision,
        resolvedBy: auth.programId,
        resolvedAt: now,
        resolution: args.reasoning || "",
        version: proposal.version + 1,
      });
    }


    // Notify subscribers if state was updated
    if (stateUpdated) {
      await notifySubscribers(auth, proposal.namespace, proposal.key, newVersionApplied, "gsp");
    }

    // Step 6: Notify proposer
    const { sendMessageHandler } = await import("./relay.js");
    
    const notificationMessage = args.reasoning
      ? `[GSP] Proposal ${args.proposalId} ${args.decision}: ${proposal.namespace}/${proposal.key}. ${args.reasoning}`
      : `[GSP] Proposal ${args.proposalId} ${args.decision}: ${proposal.namespace}/${proposal.key}`;

    const messageArgs = {
      source: "gsp",
      target: proposal.proposedBy,
      message_type: "RESULT" as const,
      message: notificationMessage,
      priority: "normal" as const,
      action: "queue" as const,
    };

    try {
      await sendMessageHandler(auth, messageArgs);
    } catch (error) {
      console.error(`[GSP Resolve] Failed to notify proposer ${proposal.proposedBy}:`, error);
      // Don't fail the resolution if notification fails
    }

    // Step 6b: Notify subscribers of proposal resolution
    const resolutionMessage = args.reasoning
      ? `[GSP_PROPOSAL] Proposal ${args.proposalId} for ${proposal.namespace}/${proposal.key} ${args.decision} by ${auth.programId}. ${args.reasoning}`
      : `[GSP_PROPOSAL] Proposal ${args.proposalId} for ${proposal.namespace}/${proposal.key} ${args.decision} by ${auth.programId}.`;
    await notifyProposalSubscribers(auth, proposal.namespace, proposal.key, resolutionMessage);

    // Step 7: Return success
    return jsonResult({
      success: true,
      proposalId: args.proposalId,
      decision: args.decision,
      stateUpdated,
      message: stateUpdated 
        ? `Proposal ${args.proposalId} approved. State updated: ${proposal.namespace}/${proposal.key}`
        : `Proposal ${args.proposalId} ${args.decision}.`,
    });

  } catch (error) {
    console.error("[GSP Resolve] Error:", error);
    return jsonResult({
      success: false,
      error: "RESOLVE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error during proposal resolution",
    });
  }
}


// ── Search schema ───────────────────────────────────────────────────────────
const GspSearchSchema = z.object({
  query: z.string().min(1).max(200),
  namespace: z.string().min(1).max(100).optional(),
  tier: z.enum(TIERS).optional(),
  limit: z.number().min(1).max(50).default(20),
});

// ── Search handler ──────────────────────────────────────────────────────────
export async function gspSearchHandler(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = GspSearchSchema.parse(rawArgs);
  const db = getFirestore();
  const userId = auth.userId;
  const queryLower = args.query.toLowerCase();

  try {
    let entriesRef;
    if (args.namespace) {
      // Search within a specific namespace
      entriesRef = db
        .collection(`tenants/${userId}/gsp/${args.namespace}/entries`);
    } else {
      // Cross-namespace search using collection group
      entriesRef = db
        .collectionGroup('entries')
        .where('__name__', '>=', `tenants/${userId}/gsp/`)
        .where('__name__', '<', `tenants/${userId}/gsp/\uffff`);
    }

    // Apply tier filter if specified
    if (args.tier) {
      entriesRef = entriesRef.where('tier', '==', args.tier);
    }

    const snapshot = await entriesRef.get();
    
    interface ScoredEntry {
      namespace: string;
      key: string;
      tier: Tier;
      description?: string;
      value: any;
      score: number;
      updatedAt: string;
      updatedBy: string;
      valueTruncated?: boolean;
    }

    const scoredEntries: ScoredEntry[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const entryKey = data.key || doc.id;
      const entryNamespace = args.namespace || doc.ref.parent.parent?.id || 'unknown';
      
      let score = 0;

      // Score based on key match
      const keyLower = entryKey.toLowerCase();
      if (keyLower === queryLower) {
        score += 10; // Exact match
      } else if (keyLower.includes(queryLower)) {
        score += 7; // Contains query
      }

      // Score based on description match
      if (data.description) {
        const descLower = data.description.toLowerCase();
        if (descLower.includes(queryLower)) {
          score += 5;
        }
      }

      // Score based on value match (stringify and search)
      try {
        const valueStr = JSON.stringify(data.value).toLowerCase();
        if (valueStr.includes(queryLower)) {
          score += 3;
        }
      } catch {
        // Skip if value can't be stringified
      }

      // Only include entries with non-zero scores
      if (score > 0) {
        // Truncate large values for display
        let displayValue = data.value;
        let valueTruncated = false;
        const valueStr = JSON.stringify(data.value);
        if (valueStr.length > 500) {
          displayValue = valueStr.substring(0, 500) + '...';
          valueTruncated = true;
        }

        scoredEntries.push({
          namespace: entryNamespace,
          key: entryKey,
          tier: data.tier,
          description: data.description,
          value: displayValue,
          score,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || 'unknown',
          updatedBy: data.updatedBy || 'unknown',
          valueTruncated,
        });
      }
    });

    // Sort by score descending, then by key ascending
    scoredEntries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.key.localeCompare(b.key);
    });

    // Apply limit
    const results = scoredEntries.slice(0, args.limit);

    return jsonResult({
      success: true,
      query: args.query,
      namespace: args.namespace || 'all',
      tier: args.tier || 'all',
      matchCount: scoredEntries.length,
      returnedCount: results.length,
      results,
    });
  } catch (err: any) {
    return jsonResult({
      success: false,
      error: `Search failed: ${err.message}`,
    });
  }
}
