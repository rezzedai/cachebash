/**
 * CacheBash Memory SDK Types
 */

/**
 * A learned pattern stored in program memory.
 */
export interface MemoryPattern {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
  discoveredAt: string;
  lastReinforced: string;
  promotedToStore: boolean;
  stale: boolean;
}

/**
 * Memory health statistics.
 */
export interface MemoryHealth {
  totalPatterns: number;
  promotedPatterns: number;
  stalePatterns: number;
  domains: string[];
  avgConfidence: number;
  oldestPattern: string | null;
  newestPattern: string | null;
  decay: {
    contextSummaryTTLDays: number;
    learnedPatternMaxAge: number;
    maxUnpromotedPatterns: number;
    lastDecayRun: string;
  };
}

/**
 * Configuration for CacheBashMemory client.
 */
export interface CacheBashMemoryConfig {
  /**
   * CacheBash API key (required).
   */
  apiKey: string;

  /**
   * MCP endpoint URL.
   * @default "https://api.cachebash.dev/v1/mcp"
   */
  endpoint?: string;

  /**
   * Program ID for memory operations.
   */
  programId: string;
}

/**
 * Options for recalling memories.
 */
export interface RecallOptions {
  /**
   * Filter by domain (optional).
   */
  domain?: string;

  /**
   * Text search query (optional).
   */
  search?: string;
}

/**
 * Pattern to store in memory.
 */
export interface StorePatternInput {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
}
