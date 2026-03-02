import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import { REGISTERED_PROGRAMS, SPECIAL_PROGRAMS, PROGRAM_GROUPS, PROGRAM_REGISTRY } from "../config/programs.js";
import type { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

// === ProgramDoc Interface ===
export interface ProgramDoc {
  programId: string;
  displayName: string;
  role: string;
  color: string;
  groups: string[];
  tags: string[];
  createdAt: any; // Firestore Timestamp
  createdBy: string;
  active: boolean;
}

// === In-Memory Cache ===
// Map<tenantId, Map<programId, { doc: ProgramDoc, cachedAt: number }>>
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const programCache = new Map<string, Map<string, { doc: ProgramDoc; cachedAt: number }>>();

function getCachedProgram(userId: string, programId: string): ProgramDoc | null {
  const tenantCache = programCache.get(userId);
  if (!tenantCache) return null;
  const entry = tenantCache.get(programId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    tenantCache.delete(programId);
    return null;
  }
  return entry.doc;
}

function setCachedProgram(userId: string, programId: string, doc: ProgramDoc): void {
  let tenantCache = programCache.get(userId);
  if (!tenantCache) {
    tenantCache = new Map();
    programCache.set(userId, tenantCache);
  }
  tenantCache.set(programId, { doc, cachedAt: Date.now() });
}

function invalidateCache(userId: string, programId?: string): void {
  if (programId) {
    programCache.get(userId)?.delete(programId);
  } else {
    programCache.delete(userId);
  }
}

// Cache for full tenant program lists
const listCache = new Map<string, { programs: ProgramDoc[]; cachedAt: number }>();

function invalidateListCache(userId: string): void {
  listCache.delete(userId);
}

// === Core Functions ===

/**
 * Check if a program is registered (in Firestore or hardcoded).
 * Uses cache with 5-min TTL.
 */
export async function isProgramRegistered(userId: string, programId: string): Promise<boolean> {
  // Always accept hardcoded programs (backward compat)
  if ((REGISTERED_PROGRAMS as readonly string[]).includes(programId) ||
      (SPECIAL_PROGRAMS as readonly string[]).includes(programId)) {
    return true;
  }

  // Check cache
  const cached = getCachedProgram(userId, programId);
  if (cached) return cached.active;

  // Check Firestore
  const db = getFirestore();
  const doc = await db.doc(`tenants/${userId}/programs/${programId}`).get();
  if (doc.exists) {
    const data = doc.data() as ProgramDoc;
    setCachedProgram(userId, programId, data);
    return data.active !== false;
  }

  return false;
}

/**
 * Register a new program in Firestore.
 */
export async function registerProgram(
  userId: string,
  opts: {
    programId: string;
    displayName: string;
    role: string;
    color: string;
    groups: string[];
    tags: string[];
    createdBy: string;
  }
): Promise<ProgramDoc> {
  const db = getFirestore();
  const doc: ProgramDoc = {
    programId: opts.programId,
    displayName: opts.displayName,
    role: opts.role,
    color: opts.color,
    groups: opts.groups,
    tags: opts.tags,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: opts.createdBy,
    active: true,
  };

  await db.doc(`tenants/${userId}/programs/${opts.programId}`).set(doc);
  setCachedProgram(userId, opts.programId, doc);
  invalidateListCache(userId);
  return doc;
}

/**
 * Get all programs with role matching the given role string.
 */
export async function getProgramsByRole(userId: string, role: string): Promise<string[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection(`tenants/${userId}/programs`)
    .where("role", "==", role)
    .where("active", "==", true)
    .get();

  const programIds = snapshot.docs.map((d) => d.id);

  // Also check hardcoded PROGRAM_REGISTRY for role matches
  for (const [pid, meta] of Object.entries(PROGRAM_REGISTRY)) {
    if (meta.role.toLowerCase() === role.toLowerCase() && !programIds.includes(pid)) {
      programIds.push(pid);
    }
  }

  return programIds;
}

/**
 * Resolve targets — async, Firestore-backed, with @role prefix support.
 * Replaces the sync resolveTargets from programs.ts.
 */
export async function resolveTargetsAsync(userId: string, target: string): Promise<string[]> {
  // 1. Named group (backward compat from hardcoded PROGRAM_GROUPS)
  if (target in PROGRAM_GROUPS) {
    return [...PROGRAM_GROUPS[target]];
  }

  // 2. Also check Firestore for programs in this group
  if (target in PROGRAM_GROUPS) {
    // Already handled above
  }

  // 3. Role-based: @builder, @orchestrator, etc.
  if (target.startsWith("@")) {
    const role = target.slice(1);
    const programs = await getProgramsByRole(userId, role);
    if (programs.length > 0) return programs;
    // Fallback: treat as unknown target
    return [target];
  }

  // 4. Exact program match or unknown — deliver anyway (it'll queue)
  return [target];
}

/**
 * Seed hardcoded programs into Firestore on boot. Upsert — only creates if not already present.
 */
export async function seedPrograms(userId: string): Promise<{ seeded: number; skipped: number }> {
  const db = getFirestore();
  const allPrograms = [...REGISTERED_PROGRAMS, ...SPECIAL_PROGRAMS];
  let seeded = 0;
  let skipped = 0;

  // Process in batches of 500 (Firestore batch limit)
  const BATCH_SIZE = 500;
  for (let i = 0; i < allPrograms.length; i += BATCH_SIZE) {
    const chunk = allPrograms.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const programId of chunk) {
      const ref = db.doc(`tenants/${userId}/programs/${programId}`);
      const existing = await ref.get();
      if (existing.exists) {
        skipped++;
        continue;
      }

      const meta = PROGRAM_REGISTRY[programId as keyof typeof PROGRAM_REGISTRY];
      const groups = getGroupsForProgram(programId);

      batch.set(ref, {
        programId,
        displayName: meta?.displayName || programId,
        role: meta?.role || "custom",
        color: meta?.color || "#808080",
        groups,
        tags: [],
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "system",
        active: true,
      });
      seeded++;
    }

    if (seeded > 0 || chunk.length > 0) {
      await batch.commit();
    }
  }

  // Invalidate cache for this tenant after seeding
  invalidateCache(userId);
  invalidateListCache(userId);

  return { seeded, skipped };
}

/** Derive which groups a program belongs to from hardcoded PROGRAM_GROUPS */
function getGroupsForProgram(programId: string): string[] {
  const groups: string[] = [];
  for (const [groupName, members] of Object.entries(PROGRAM_GROUPS)) {
    if ((members as readonly string[]).includes(programId)) {
      groups.push(groupName);
    }
  }
  return groups;
}

// === Tool Handlers ===

const ListProgramsSchema = z.object({
  role: z.string().max(100).optional(),
  group: z.string().max(100).optional(),
  active: z.boolean().default(true),
});

const UpdateProgramSchema = z.object({
  programId: z.string().max(100),
  displayName: z.string().max(200).optional(),
  role: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  groups: z.array(z.string().max(100)).optional(),
  tags: z.array(z.string().max(100)).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function listProgramsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ListProgramsSchema.parse(rawArgs || {});
  const db = getFirestore();

  // Check list cache first
  const cacheEntry = listCache.get(auth.userId);
  let allPrograms: ProgramDoc[];

  if (cacheEntry && Date.now() - cacheEntry.cachedAt < CACHE_TTL_MS) {
    allPrograms = cacheEntry.programs;
  } else {
    const snapshot = await db.collection(`tenants/${auth.userId}/programs`).get();
    allPrograms = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        programId: d.id,
        displayName: data.displayName || d.id,
        role: data.role || "custom",
        color: data.color || "#808080",
        groups: data.groups || [],
        tags: data.tags || [],
        createdAt: data.createdAt,
        createdBy: data.createdBy || "unknown",
        active: data.active !== false,
      } as ProgramDoc;
    });
    listCache.set(auth.userId, { programs: allPrograms, cachedAt: Date.now() });
  }

  // Apply filters
  let filtered = allPrograms;
  if (args.role) {
    filtered = filtered.filter((p) => p.role.toLowerCase() === args.role!.toLowerCase());
  }
  if (args.group) {
    filtered = filtered.filter((p) => p.groups.includes(args.group!));
  }
  if (args.active !== undefined) {
    filtered = filtered.filter((p) => p.active === args.active);
  }

  return jsonResult({
    success: true,
    count: filtered.length,
    programs: filtered.map((p) => ({
      programId: p.programId,
      displayName: p.displayName,
      role: p.role,
      color: p.color,
      groups: p.groups,
      tags: p.tags,
      active: p.active,
      createdBy: p.createdBy,
      createdAt: p.createdAt?.toDate?.()?.toISOString?.() || null,
    })),
  });
}

export async function updateProgramHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateProgramSchema.parse(rawArgs);
  const db = getFirestore();

  const ref = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);
  const existing = await ref.get();

  if (!existing.exists) {
    return jsonResult({ success: false, error: `Program not found: "${args.programId}"` });
  }

  // Access control: programs can update their own entry, admin can update any
  const isAdmin = ["legacy", "mobile", "orchestrator", "iso", "vector", "dispatcher"].includes(auth.programId);
  const isSelf = auth.programId === args.programId;
  if (!isAdmin && !isSelf) {
    return jsonResult({ success: false, error: "Access denied: can only update your own program entry" });
  }

  const updates: Record<string, unknown> = {};
  if (args.displayName !== undefined) updates.displayName = args.displayName;
  if (args.role !== undefined) updates.role = args.role;
  if (args.color !== undefined) updates.color = args.color;
  if (args.groups !== undefined) updates.groups = args.groups;
  if (args.tags !== undefined) updates.tags = args.tags;
  updates.updatedAt = FieldValue.serverTimestamp();
  updates.updatedBy = auth.programId;

  await ref.update(updates);

  // Invalidate caches
  invalidateCache(auth.userId, args.programId);
  invalidateListCache(auth.userId);

  return jsonResult({
    success: true,
    programId: args.programId,
    updated: Object.keys(updates).filter((k) => k !== "updatedAt" && k !== "updatedBy"),
    message: `Program "${args.programId}" updated.`,
  });
}
