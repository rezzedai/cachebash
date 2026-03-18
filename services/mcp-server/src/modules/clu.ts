/**
 * CLU Intelligence Service Module
 * Tools: clu_ingest, clu_analyze, clu_report
 * Collection: tenants/{uid}/clu_sessions/{sessionId}/ingestions|analyses|reports
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import type {
  Ingestion,
  Analysis,
  Report,
} from "../types/clu.js";

// Schemas
const CluIngestSchema = z.object({
  content: z.string().min(1).max(500000),
  source_type: z.enum(["transcript", "url", "text", "document"]),
  source_url: z.string().url().optional(),
  metadata: z.object({
    speakers: z.array(z.string()).optional(),
    date: z.string().optional(),
    topic: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  session_id: z.string().max(100).optional(),
});

const CluAnalyzeSchema = z.object({
  session_id: z.string().max(100),
  analysis_type: z.enum(["patterns", "opportunities", "gaps", "synthesis", "full"]).default("full"),
  focus_domains: z.array(z.string()).optional(),
  confidence_threshold: z.number().min(0).max(1).default(0.5),
  results: z.object({
    patterns: z.array(z.object({
      pattern: z.string(),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string()),
    })).optional().default([]),
    opportunities: z.array(z.object({
      opportunity: z.string(),
      whyThisCouldFail: z.string(),
      confidence: z.number().min(0).max(1),
    })).optional().default([]),
    gaps: z.array(z.object({
      gap: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      impact: z.string(),
    })).optional().default([]),
    blindSpots: z.array(z.object({
      blindSpot: z.string(),
      reasoning: z.string(),
    })).optional().default([]),
    summary: z.string().optional().default(""),
  }),
});

const CluReportSchema = z.object({
  analysis_id: z.string().max(100),
  report_type: z.enum(["opportunity_brief", "synthesis", "prd", "executive_summary"]).default("synthesis"),
  format: z.enum(["markdown", "json"]).default("markdown"),
  content: z.string().min(1).max(500000),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function estimateTokenCount(text: string): number {
  // Simple token estimation: words / 0.75
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  return Math.ceil(words / 0.75);
}

// === Tool: clu_ingest ===
export async function cluIngestHandler(
  auth: AuthContext,
  args: z.infer<typeof CluIngestSchema>
): Promise<ToolResult> {
  const parsed = CluIngestSchema.parse(args);
  const db = getFirestore();
  const now = new Date().toISOString();

  const ingestionId = generateId();
  const sessionId = parsed.session_id || generateId();
  const tokenCount = estimateTokenCount(parsed.content);

  const ingestion: Ingestion = {
    ingestionId,
    sessionId,
    content: parsed.content,
    sourceType: parsed.source_type,
    sourceUrl: parsed.source_url,
    metadata: parsed.metadata,
    tokenCount,
    createdAt: now,
    status: "ready",
  };

  await db
    .collection("tenants")
    .doc(auth.userId)
    .collection("clu_sessions")
    .doc(sessionId)
    .collection("ingestions")
    .doc(ingestionId)
    .set(ingestion);

  return jsonResult({
    ingestion_id: ingestionId,
    session_id: sessionId,
    token_count: tokenCount,
    status: "ready",
  });
}

// === Tool: clu_analyze ===
export async function cluAnalyzeHandler(
  auth: AuthContext,
  args: z.infer<typeof CluAnalyzeSchema>
): Promise<ToolResult> {
  const parsed = CluAnalyzeSchema.parse(args);
  const db = getFirestore();
  const now = new Date().toISOString();

  const analysisId = generateId();

  const analysis: Analysis = {
    analysisId,
    sessionId: parsed.session_id,
    analysisType: parsed.analysis_type,
    focusDomains: parsed.focus_domains,
    confidenceThreshold: parsed.confidence_threshold,
    patterns: parsed.results.patterns,
    opportunities: parsed.results.opportunities,
    gaps: parsed.results.gaps,
    blindSpots: parsed.results.blindSpots,
    summary: parsed.results.summary,
    createdAt: now,
    tokenCount: 0,
  };

  // Filter by confidence threshold
  analysis.patterns = analysis.patterns.filter(p => p.confidence >= parsed.confidence_threshold);
  analysis.opportunities = analysis.opportunities.filter(o => o.confidence >= parsed.confidence_threshold);

  // Store analysis
  await db
    .collection("tenants")
    .doc(auth.userId)
    .collection("clu_sessions")
    .doc(parsed.session_id)
    .collection("analyses")
    .doc(analysisId)
    .set(analysis);

  return jsonResult({
    analysis_id: analysisId,
    session_id: parsed.session_id,
    patterns: analysis.patterns,
    opportunities: analysis.opportunities,
    gaps: analysis.gaps,
    blind_spots: analysis.blindSpots,
    summary: analysis.summary,
  });
}

// === Tool: clu_report ===
export async function cluReportHandler(
  auth: AuthContext,
  args: z.infer<typeof CluReportSchema>
): Promise<ToolResult> {
  const parsed = CluReportSchema.parse(args);
  const db = getFirestore();
  const now = new Date().toISOString();

  // Find the analysis (need to search across sessions)
  const sessionsSnapshot = await db
    .collection("tenants")
    .doc(auth.userId)
    .collection("clu_sessions")
    .get();

  let sessionId: string | null = null;

  for (const sessionDoc of sessionsSnapshot.docs) {
    const analysisDoc = await db
      .collection("tenants")
      .doc(auth.userId)
      .collection("clu_sessions")
      .doc(sessionDoc.id)
      .collection("analyses")
      .doc(parsed.analysis_id)
      .get();

    if (analysisDoc.exists) {
      sessionId = sessionDoc.id;
      break;
    }
  }

  if (!sessionId) {
    return jsonResult({ error: "Analysis not found" });
  }

  const reportContent = parsed.content;
  const reportId = generateId();
  const reportTokenCount = estimateTokenCount(reportContent);

  const report: Report = {
    reportId,
    analysisId: parsed.analysis_id,
    sessionId,
    reportType: parsed.report_type,
    format: parsed.format,
    content: reportContent,
    metadata: {
      generatedAt: now,
      tokenCount: reportTokenCount,
    },
  };

  // Store report
  await db
    .collection("tenants")
    .doc(auth.userId)
    .collection("clu_sessions")
    .doc(sessionId)
    .collection("reports")
    .doc(reportId)
    .set(report);

  return jsonResult({
    report_id: reportId,
    report_type: parsed.report_type,
    content: reportContent,
    metadata: report.metadata,
  });
}
