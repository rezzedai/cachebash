/**
 * CacheBashMemory — SDK client for memory pattern storage and recall.
 */

import type {
  CacheBashMemoryConfig,
  MemoryPattern,
  MemoryHealth,
  RecallOptions,
  StorePatternInput,
} from "./types.js";

interface MCPRequest {
  jsonrpc: "2.0";
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
  id: number;
}

interface MCPResponse {
  jsonrpc: "2.0";
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

export class CacheBashMemory {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly programId: string;
  private requestId = 1;

  constructor(config: CacheBashMemoryConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint || "https://api.cachebash.dev/v1/mcp";
    this.programId = config.programId;

    if (!this.apiKey) {
      throw new Error("CacheBashMemory: apiKey is required");
    }
    if (!this.programId) {
      throw new Error("CacheBashMemory: programId is required");
    }
  }

  /**
   * Store a memory pattern.
   * If a pattern with the same ID exists, it will be replaced.
   */
  async store(input: StorePatternInput): Promise<void> {
    const now = new Date().toISOString();
    const pattern: MemoryPattern = {
      ...input,
      discoveredAt: now,
      lastReinforced: now,
      promotedToStore: false,
      stale: false,
    };

    const result = await this.callTool("store_memory", {
      programId: this.programId,
      pattern,
    });

    if (!result.success) {
      throw new Error(`Failed to store memory: ${result.error || "Unknown error"}`);
    }
  }

  /**
   * Recall memory patterns with optional filters.
   */
  async recall(options?: RecallOptions): Promise<MemoryPattern[]> {
    const result = await this.callTool("recall_memory", {
      programId: this.programId,
      domain: options?.domain,
      query: options?.search,
      includeStale: false,
    });

    if (!result.success) {
      throw new Error(`Failed to recall memory: ${result.error || "Unknown error"}`);
    }

    return result.patterns || [];
  }

  /**
   * Get memory health statistics.
   */
  async health(): Promise<MemoryHealth> {
    const result = await this.callTool("memory_health", {
      programId: this.programId,
    });

    if (!result.success) {
      throw new Error(`Failed to get memory health: ${result.error || "Unknown error"}`);
    }

    return result.health;
  }

  /**
   * Call an MCP tool via HTTP transport.
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const request: MCPRequest = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
      id: this.requestId++,
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: MCPResponse = await response.json();

    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }

    if (!data.result) {
      throw new Error("MCP response missing result");
    }

    if (data.result.isError) {
      const errorText = data.result.content[0]?.text || "Unknown error";
      throw new Error(`MCP tool error: ${errorText}`);
    }

    // Parse the text content as JSON
    const textContent = data.result.content[0]?.text;
    if (!textContent) {
      throw new Error("MCP response missing content");
    }

    return JSON.parse(textContent);
  }
}
