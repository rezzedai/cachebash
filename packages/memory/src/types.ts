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
  activePatterns: number;
  promotedPatterns: number;
  stalePatterns: number;
  domains: string[];
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
  decay: {
    maxUnpromotedPatterns: number;
    learnedPatternMaxAge: number;
    lastDecayRun: string | null;
  };
}

/**
 * Transport mode for the SDK client.
 * - "mcp": JSON-RPC over MCP transport (default)
 * - "rest": RESTful HTTP transport (simpler, no session management)
 */
export type TransportMode = "mcp" | "rest";

/**
 * Configuration for CacheBashMemory client.
 */
export interface CacheBashMemoryConfig {
  /**
   * CacheBash API key (required).
   */
  apiKey: string;

  /**
   * Base API endpoint URL.
   * For MCP transport: defaults to "https://api.cachebash.dev/v1/mcp"
   * For REST transport: defaults to "https://api.cachebash.dev"
   */
  endpoint?: string;

  /**
   * Program ID for memory operations.
   */
  programId: string;

  /**
   * Transport mode.
   * @default "rest"
   */
  transport?: TransportMode;
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

  /**
   * Include stale patterns (optional).
   */
  includeStale?: boolean;
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

/**
 * Options for reinforcing a memory pattern.
 */
export interface ReinforceOptions {
  /**
   * Updated confidence score (optional).
   */
  confidence?: number;

  /**
   * Updated evidence text (optional).
   */
  evidence?: string;
}
