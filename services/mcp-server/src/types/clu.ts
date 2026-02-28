/**
 * CLU Intelligence Service Types
 * Collection: tenants/{uid}/clu_sessions/{sessionId}/ingestions|analyses|reports
 */

export type SourceType = "transcript" | "url" | "text" | "document";

export type AnalysisType = "patterns" | "opportunities" | "gaps" | "synthesis" | "full";

export type ReportType = "opportunity_brief" | "synthesis" | "prd" | "executive_summary";

export type ReportFormat = "markdown" | "json";

export interface IngestionMetadata {
  speakers?: string[];
  date?: string;
  topic?: string;
  tags?: string[];
}

export interface Ingestion {
  ingestionId: string;
  sessionId: string;
  content: string;
  sourceType: SourceType;
  sourceUrl?: string;
  metadata?: IngestionMetadata;
  tokenCount: number;
  createdAt: string;
  status: "ready";
}

export interface Pattern {
  pattern: string;
  confidence: number;
  evidence: string[];
}

export interface Opportunity {
  opportunity: string;
  whyThisCouldFail: string;
  confidence: number;
}

export interface Gap {
  gap: string;
  severity: "low" | "medium" | "high" | "critical";
  impact: string;
}

export interface BlindSpot {
  blindSpot: string;
  reasoning: string;
}

export interface Analysis {
  analysisId: string;
  sessionId: string;
  analysisType: AnalysisType;
  focusDomains?: string[];
  confidenceThreshold: number;
  patterns: Pattern[];
  opportunities: Opportunity[];
  gaps: Gap[];
  blindSpots: BlindSpot[];
  summary: string;
  createdAt: string;
  tokenCount: number;
}

export interface Report {
  reportId: string;
  analysisId: string;
  sessionId: string;
  reportType: ReportType;
  format: ReportFormat;
  content: string;
  metadata: {
    generatedAt: string;
    tokenCount: number;
  };
}
