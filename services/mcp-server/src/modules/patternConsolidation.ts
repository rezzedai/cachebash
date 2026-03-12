/**
 * Pattern Consolidation Module — GSP-P5
 * 
 * Auto-promotes patterns when N+ agents learn the same pattern.
 * Scans all program states for learnedPatterns, groups by similarity,
 * and promotes convergent patterns to GSP knowledge store.
 * 
 * Firestore schema:
 *   - Program states: tenants/{userId}/programs/{programId} → field: learnedPatterns
 *   - GSP entries: tenants/{userId}/gsp/knowledge/entries/pattern/{domain}/{slug}
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { gspWriteHandler } from "./gsp.js";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 2; // Minimum agents required for promotion
const MAX_THRESHOLD = 10;
const GSP_NAMESPACE = "knowledge";
const GSP_TIER = "architectural";

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const ConsolidateSchema = z.object({
  threshold: z.number().min(1).max(MAX_THRESHOLD).default(DEFAULT_THRESHOLD),
  dryRun: z.boolean().default(false),
  domain: z.string().max(100).optional(), // Filter by domain
  projectId: z.string().max(100).optional(), // Filter by project
});

// ── Types ───────────────────────────────────────────────────────────────────

interface LearnedPattern {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
  discoveredAt: string;
  lastReinforced: string;
  promotedToStore: boolean;
  stale: boolean;
  projectId?: string;
}

interface ProgramState {
  learnedPatterns?: LearnedPattern[];
}

interface PatternGroup {
  domain: string;
  normalizedPattern: string;
  patterns: Array<{
    programId: string;
    pattern: LearnedPattern;
  }>;
  avgConfidence: number;
  firstSeen: string;
  lastSeen: string;
}

interface PromotedPattern {
  domain: string;
  key: string;
  pattern: string;
  confidence: number;
  contributors: string[];
  firstSeen: string;
  lastSeen: string;
  evidenceCount: number;
}

interface ConsolidationResult {
  promoted: PromotedPattern[];
  candidates: PatternGroup[];
  stats: {
    totalPatterns: number;
    uniqueDomains: number;
    promoted: number;
    candidates: number;
  };
}

interface ConsolidatedPattern {
  key: string;
  domain: string;
  pattern: string;
  confidence: number;
  contributors: string[];
  evidenceCount: number;
  firstSeen: string;
  lastSeen: string;
  promotedAt: string;
  updatedAt: string;
}

type ToolResult = { content: Array<{ type: string; text: string }> };

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * Normalize pattern text for similarity comparison.
 * Lowercases, removes extra whitespace, strips punctuation.
 */
function normalizePattern(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Generate a slug from pattern text for GSP key.
 */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 60); // Keep reasonable length
}

/**
 * Group patterns by domain and normalized text.
 */
function groupPatterns(
  allPatterns: Array<{ programId: string; pattern: LearnedPattern }>
): Map<string, PatternGroup> {
  const groups = new Map<string, PatternGroup>();

  for (const item of allPatterns) {
    const { programId, pattern } = item;
    
    // Skip already-promoted or stale patterns
    if (pattern.promotedToStore || pattern.stale) continue;

    const normalized = normalizePattern(pattern.pattern);
    const groupKey = `${pattern.domain}::${normalized}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        domain: pattern.domain,
        normalizedPattern: normalized,
        patterns: [],
        avgConfidence: 0,
        firstSeen: pattern.discoveredAt,
        lastSeen: pattern.lastReinforced,
      };
      groups.set(groupKey, group);
    }

    group.patterns.push({ programId, pattern });

    // Update aggregate fields
    const dates = group.patterns.map(p => p.pattern.discoveredAt);
    group.firstSeen = dates.sort()[0];
    
    const reinforcedDates = group.patterns.map(p => p.pattern.lastReinforced);
    group.lastSeen = reinforcedDates.sort().reverse()[0];

    const confidences = group.patterns.map(p => p.pattern.confidence);
    group.avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  return groups;
}

// ── Handlers ────────────────────────────────────────────────────────────────

/**
 * Consolidate patterns handler — scans all program states and promotes convergent patterns.
 */
export async function consolidatePatternsHandler(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = ConsolidateSchema.parse(rawArgs);
  const db = getFirestore();
  const programsPath = `tenants/${auth.userId}/programs`;

  // 1. Scan all program states for learnedPatterns
  const programsSnap = await db.collection(programsPath).get();
  const allPatterns: Array<{ programId: string; pattern: LearnedPattern }> = [];

  for (const doc of programsSnap.docs) {
    const programId = doc.id;
    const state = doc.data() as ProgramState;
    
    if (!state.learnedPatterns || state.learnedPatterns.length === 0) continue;

    for (const pattern of state.learnedPatterns) {
      // Apply domain filter if provided
      if (args.domain && pattern.domain !== args.domain) continue;
      // Apply projectId filter if provided
      if (args.projectId && pattern.projectId !== args.projectId) continue;

      allPatterns.push({ programId, pattern });
    }
  }

  // 2. Group patterns by similarity
  const groups = groupPatterns(allPatterns);

  // 3. Identify promotion candidates (N+ agents with same pattern)
  const promotionCandidates: PatternGroup[] = [];
  const belowThreshold: PatternGroup[] = [];

  for (const group of groups.values()) {
    if (group.patterns.length >= args.threshold) {
      promotionCandidates.push(group);
    } else {
      belowThreshold.push(group);
    }
  }

  // 4. Promote patterns to GSP knowledge store
  const promoted: PromotedPattern[] = [];

  if (!args.dryRun && promotionCandidates.length > 0) {
    for (const group of promotionCandidates) {
      const slug = generateSlug(group.normalizedPattern);
      const key = `pattern/${group.domain}/${slug}`;
      
      // Use the original pattern text from the highest confidence contributor
      const bestPattern = group.patterns
        .sort((a, b) => b.pattern.confidence - a.pattern.confidence)[0]
        .pattern.pattern;

      const contributors = group.patterns.map(p => p.programId);
      const evidenceCount = group.patterns.length;

      // Write to GSP via gsp_write handler
      const gspPayload = {
        namespace: GSP_NAMESPACE,
        key,
        tier: GSP_TIER,
        value: {
          domain: group.domain,
          pattern: bestPattern,
          confidence: group.avgConfidence,
          contributors,
          firstSeen: group.firstSeen,
          lastSeen: group.lastSeen,
          evidenceCount,
          promotedAt: new Date().toISOString(),
          source: "pattern-consolidation",
          ...(args.projectId ? { projectId: args.projectId } : {}),
        },
        description: `Auto-promoted pattern from ${evidenceCount} agents in domain: ${group.domain}`,
        source: "pattern-consolidation",
      };

      try {
        await gspWriteHandler(auth, gspPayload);

        promoted.push({
          domain: group.domain,
          key,
          pattern: bestPattern,
          confidence: group.avgConfidence,
          contributors,
          firstSeen: group.firstSeen,
          lastSeen: group.lastSeen,
          evidenceCount,
        });

        // Mark source patterns as promoted
        for (const item of group.patterns) {
          const programRef = db.doc(`${programsPath}/${item.programId}`);
          const programDoc = await programRef.get();
          
          if (programDoc.exists) {
            const programState = programDoc.data() as ProgramState;
            if (programState.learnedPatterns) {
              const updatedPatterns = programState.learnedPatterns.map(p =>
                p.id === item.pattern.id ? { ...p, promotedToStore: true } : p
              );
              await programRef.update({ learnedPatterns: updatedPatterns });
            }
          }
        }
      } catch (error) {
        console.error(`[PatternConsolidation] Failed to promote pattern ${key}:`, error);
        // Continue with other promotions
      }
    }
  }

  // 5. Build result
  const stats = {
    totalPatterns: allPatterns.length,
    uniqueDomains: new Set(allPatterns.map(p => p.pattern.domain)).size,
    promoted: promoted.length,
    candidates: belowThreshold.length,
  };

  const result: ConsolidationResult = {
    promoted,
    candidates: belowThreshold.map(g => ({
      domain: g.domain,
      pattern: g.patterns[0].pattern.pattern, // Show one example
      contributorCount: g.patterns.length,
      avgConfidence: g.avgConfidence,
      contributors: g.patterns.map(p => p.programId),
    })) as any,
    stats,
  };

  return jsonResult({
    success: true,
    dryRun: args.dryRun,
    threshold: args.threshold,
    domainFilter: args.domain || null,
    projectFilter: args.projectId || null,
    result,
    message: args.dryRun
      ? `Dry run complete. Found ${promotionCandidates.length} patterns ready for promotion.`
      : `Promoted ${promoted.length} patterns to GSP knowledge store.`,
  });
}

/**
 * Get consolidated patterns handler — returns currently promoted patterns from GSP.
 */
export async function getConsolidatedPatternsHandler(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const db = getFirestore();
  const gspPath = `tenants/${auth.userId}/gsp/${GSP_NAMESPACE}/entries`;

  // Query for all pattern/* entries in knowledge namespace
  const query = db.collection(gspPath)
    .where("tier", "==", GSP_TIER)
    .orderBy("updatedAt", "desc");

  const snap = await query.get();
  const patterns: ConsolidatedPattern[] = [];

  for (const doc of snap.docs) {
    const key = doc.id;
    
    // Filter for pattern/ prefix
    if (!key.startsWith("pattern/")) continue;

    const data = doc.data();
    patterns.push({
      key,
      domain: data.value?.domain || "unknown",
      pattern: data.value?.pattern || "",
      confidence: data.value?.confidence || 0,
      contributors: data.value?.contributors || [],
      evidenceCount: data.value?.evidenceCount || 0,
      firstSeen: data.value?.firstSeen || "",
      lastSeen: data.value?.lastSeen || "",
      promotedAt: data.value?.promotedAt || "",
      updatedAt: data.updatedAt || "",
    });
  }

  // Group by domain for summary
  const byDomain: Record<string, ConsolidatedPattern[]> = patterns.reduce((acc, p) => {
    if (!acc[p.domain]) acc[p.domain] = [];
    acc[p.domain].push(p);
    return acc;
  }, {} as Record<string, ConsolidatedPattern[]>);

  return jsonResult({
    success: true,
    patterns,
    count: patterns.length,
    byDomain: Object.entries(byDomain).map(([domain, items]) => ({
      domain,
      count: items.length,
      avgConfidence: items.reduce((sum, p) => sum + p.confidence, 0) / items.length,
    })),
    message: `Found ${patterns.length} consolidated patterns across ${Object.keys(byDomain).length} domains.`,
  });
}
