/**
 * CLU Intelligence Service Module
 * Tools: clu_ingest, clu_analyze, clu_report
 * Collection: tenants/{uid}/clu_sessions/{sessionId}/ingestions|analyses|reports
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Ingestion,
  IngestionMetadata,
  Analysis,
  Report,
  SourceType,
  AnalysisType,
  ReportType,
  ReportFormat,
} from "../types/clu.js";

// Anthropic client (API key from env)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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
});

const CluReportSchema = z.object({
  analysis_id: z.string().max(100),
  report_type: z.enum(["opportunity_brief", "synthesis", "prd", "executive_summary"]).default("synthesis"),
  format: z.enum(["markdown", "json"]).default("markdown"),
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

  // Load all ingestions for this session
  const ingestionsSnapshot = await db
    .collection("tenants")
    .doc(auth.userId)
    .collection("clu_sessions")
    .doc(parsed.session_id)
    .collection("ingestions")
    .get();

  if (ingestionsSnapshot.empty) {
    return jsonResult({ error: "No ingestions found for this session" });
  }

  // Concatenate all content
  const allContent = ingestionsSnapshot.docs
    .map(doc => doc.data().content)
    .join("\n\n---\n\n");

  const totalTokens = estimateTokenCount(allContent);

  // Build analysis prompt based on analysis_type
  let systemPrompt = "You are CLU, an intelligence service that extracts insights from content.";
  let userPrompt = "";

  const focusSection = parsed.focus_domains && parsed.focus_domains.length > 0
    ? `Focus domains: ${parsed.focus_domains.join(", ")}\n\n`
    : "";

  if (parsed.analysis_type === "patterns" || parsed.analysis_type === "full") {
    userPrompt += `${focusSection}Extract recurring patterns from the following content. For each pattern, provide:
- pattern (string): The pattern itself
- confidence (0-1): How confident you are this is a real pattern
- evidence (array of strings): Specific quotes or examples

Respond in JSON format: { "patterns": [...] }

Content:
${allContent}
`;
  }

  if (parsed.analysis_type === "opportunities" || parsed.analysis_type === "full") {
    userPrompt += `\n\n${focusSection}Identify opportunities from the following content. For each opportunity, provide:
- opportunity (string): Description of the opportunity
- whyThisCouldFail (string): Critical failure modes
- confidence (0-1): Confidence this is a real opportunity

Respond in JSON format: { "opportunities": [...] }

Content:
${allContent}
`;
  }

  if (parsed.analysis_type === "gaps" || parsed.analysis_type === "full") {
    userPrompt += `\n\n${focusSection}Identify gaps and missing elements from the following content. For each gap, provide:
- gap (string): What is missing
- severity (low|medium|high|critical): How important this gap is
- impact (string): What impact this gap has

Respond in JSON format: { "gaps": [...] }

Content:
${allContent}
`;
  }

  if (parsed.analysis_type === "synthesis" || parsed.analysis_type === "full") {
    userPrompt += `\n\n${focusSection}Identify blind spots — things not mentioned but critically important. For each blind spot, provide:
- blindSpot (string): What is being overlooked
- reasoning (string): Why this matters

Also provide a summary (string) synthesizing the key insights.

Respond in JSON format: { "blindSpots": [...], "summary": "..." }

Content:
${allContent}
`;
  }

  // Call Anthropic API
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  // Parse response
  const responseText = response.content[0].type === "text" ? response.content[0].text : "";
  let parsedResponse: any = {};

  try {
    parsedResponse = JSON.parse(responseText);
  } catch (err) {
    // If JSON parsing fails, try to extract JSON from markdown code blocks
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      parsedResponse = JSON.parse(jsonMatch[1]);
    } else {
      return jsonResult({ error: "Failed to parse LLM response as JSON", raw: responseText });
    }
  }

  const analysisId = generateId();

  const analysis: Analysis = {
    analysisId,
    sessionId: parsed.session_id,
    analysisType: parsed.analysis_type,
    focusDomains: parsed.focus_domains,
    confidenceThreshold: parsed.confidence_threshold,
    patterns: parsedResponse.patterns || [],
    opportunities: parsedResponse.opportunities || [],
    gaps: parsedResponse.gaps || [],
    blindSpots: parsedResponse.blindSpots || [],
    summary: parsedResponse.summary || "",
    createdAt: now,
    tokenCount: totalTokens,
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

  let analysis: Analysis | null = null;
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
      analysis = analysisDoc.data() as Analysis;
      sessionId = sessionDoc.id;
      break;
    }
  }

  if (!analysis || !sessionId) {
    return jsonResult({ error: "Analysis not found" });
  }

  // Build report prompt based on report_type
  let systemPrompt = "You are CLU, an intelligence service that generates structured reports.";
  let userPrompt = "";

  const analysisData = JSON.stringify(
    {
      patterns: analysis.patterns,
      opportunities: analysis.opportunities,
      gaps: analysis.gaps,
      blindSpots: analysis.blindSpots,
      summary: analysis.summary,
    },
    null,
    2
  );

  switch (parsed.report_type) {
    case "opportunity_brief":
      userPrompt = `Generate a concise opportunity brief based on this analysis. Focus on actionable opportunities with clear next steps.

Format: ${parsed.format === "markdown" ? "Markdown" : "JSON"}

Analysis:
${analysisData}
`;
      break;

    case "synthesis":
      userPrompt = `Generate a synthesis report that combines patterns, opportunities, and gaps into a coherent narrative.

Format: ${parsed.format === "markdown" ? "Markdown" : "JSON"}

Analysis:
${analysisData}
`;
      break;

    case "prd":
      userPrompt = `Generate a Product Requirements Document (PRD) structure based on this analysis. Include:
- Problem statement (from gaps/blind spots)
- Opportunities (from opportunities)
- Requirements (inferred from patterns)
- Success metrics

Format: ${parsed.format === "markdown" ? "Markdown" : "JSON"}

Analysis:
${analysisData}
`;
      break;

    case "executive_summary":
      userPrompt = `Generate an executive summary (1-2 paragraphs) highlighting the most critical insights.

Format: ${parsed.format === "markdown" ? "Markdown" : "JSON"}

Analysis:
${analysisData}
`;
      break;
  }

  // Call Anthropic API
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const reportContent = response.content[0].type === "text" ? response.content[0].text : "";
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
