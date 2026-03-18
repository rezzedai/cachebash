/**
 * CLU Domain Registry — Content analysis and intelligence tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { cluIngestHandler, cluAnalyzeHandler, cluReportHandler } from "../modules/clu.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  clu_ingest: cluIngestHandler,
  clu_analyze: cluAnalyzeHandler,
  clu_report: cluReportHandler,
};

export const definitions = [
  {
    name: "clu_ingest",
    description: "Ingest content for CLU analysis. Stores raw content in a session for later analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Raw text content to analyze", minLength: 1, maxLength: 500000 },
        source_type: { type: "string", enum: ["transcript", "url", "text", "document"], description: "Type of content source" },
        source_url: { type: "string", description: "Optional source URL for metadata" },
        metadata: {
          type: "object",
          description: "Optional metadata about the content",
          properties: {
            speakers: { type: "array", items: { type: "string" }, description: "List of speakers (for transcripts)" },
            date: { type: "string", description: "Date of content creation" },
            topic: { type: "string", description: "Main topic" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
          },
        },
        session_id: { type: "string", description: "Session ID to group multiple ingestions (auto-generated if not provided)", maxLength: 100 },
      },
      required: ["content", "source_type"],
    },
  },
  {
    name: "clu_analyze",
    description: "Run CLU analysis on ingested content. Extracts patterns, opportunities, gaps, and blind spots using LLM.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session ID containing ingested content", maxLength: 100 },
        analysis_type: { type: "string", enum: ["patterns", "opportunities", "gaps", "synthesis", "full"], default: "full", description: "Type of analysis to perform" },
        focus_domains: { type: "array", items: { type: "string" }, description: "Optional domains to prioritize in analysis" },
        confidence_threshold: { type: "number", minimum: 0, maximum: 1, default: 0.5, description: "Minimum confidence score for results" },
        results: {
          type: "object",
          description: "Pre-computed analysis results from the calling agent",
          properties: {
            patterns: { type: "array", items: { type: "object", properties: { pattern: { type: "string" }, confidence: { type: "number" }, evidence: { type: "array", items: { type: "string" } } }, required: ["pattern", "confidence", "evidence"] }, description: "Extracted patterns with confidence scores" },
            opportunities: { type: "array", items: { type: "object", properties: { opportunity: { type: "string" }, whyThisCouldFail: { type: "string" }, confidence: { type: "number" } }, required: ["opportunity", "whyThisCouldFail", "confidence"] }, description: "Identified opportunities" },
            gaps: { type: "array", items: { type: "object", properties: { gap: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high", "critical"] }, impact: { type: "string" } }, required: ["gap", "severity", "impact"] }, description: "Identified gaps" },
            blindSpots: { type: "array", items: { type: "object", properties: { blindSpot: { type: "string" }, reasoning: { type: "string" } }, required: ["blindSpot", "reasoning"] }, description: "Blind spots" },
            summary: { type: "string", description: "Synthesis summary" },
          },
        },
      },
      required: ["session_id", "results"],
    },
  },
  {
    name: "clu_report",
    description: "Generate a formatted report from CLU analysis results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: "Analysis ID to generate report from", maxLength: 100 },
        report_type: { type: "string", enum: ["opportunity_brief", "synthesis", "prd", "executive_summary"], default: "synthesis", description: "Type of report to generate" },
        format: { type: "string", enum: ["markdown", "json"], default: "markdown", description: "Output format" },
        content: { type: "string", description: "Pre-generated report content from the calling agent", minLength: 1, maxLength: 500000 },
      },
      required: ["analysis_id", "content"],
    },
  },
];
