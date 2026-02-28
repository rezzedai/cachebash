/**
 * CacheBashMemory — SDK client for memory pattern storage and recall.
 * Supports both MCP (JSON-RPC) and REST transports.
 */

import type {
  CacheBashMemoryConfig,
  MemoryPattern,
  MemoryHealth,
  RecallOptions,
  StorePatternInput,
  ReinforceOptions,
  TransportMode,
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

interface RESTResponse {
  success: boolean;
  data?: any;
  error?: { code: string; message: string };
}

export class CacheBashMemory {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly programId: string;
  private readonly transport: TransportMode;
  private requestId = 1;

  constructor(config: CacheBashMemoryConfig) {
    this.apiKey = config.apiKey;
    this.programId = config.programId;
    this.transport = config.transport || "rest";

    if (!this.apiKey) {
      throw new Error("CacheBashMemory: apiKey is required");
    }
    if (!this.programId) {
      throw new Error("CacheBashMemory: programId is required");
    }

    if (config.endpoint) {
      this.endpoint = config.endpoint;
    } else {
      this.endpoint = this.transport === "mcp"
        ? "https://api.cachebash.dev/v1/mcp"
        : "https://api.cachebash.dev";
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

    if (this.transport === "rest") {
      await this.restCall("POST", `/v1/memory/${this.programId}/patterns`, { pattern });
    } else {
      await this.mcpCall("store_memory", { programId: this.programId, pattern });
    }
  }

  /**
   * Recall memory patterns with optional filters.
   */
  async recall(options?: RecallOptions): Promise<MemoryPattern[]> {
    let result: any;

    if (this.transport === "rest") {
      const params = new URLSearchParams();
      if (options?.domain) params.set("domain", options.domain);
      if (options?.search) params.set("query", options.search);
      if (options?.includeStale) params.set("includeStale", "true");
      const qs = params.toString();
      result = await this.restCall("GET", `/v1/memory/${this.programId}/patterns${qs ? `?${qs}` : ""}`);
    } else {
      result = await this.mcpCall("recall_memory", {
        programId: this.programId,
        domain: options?.domain,
        query: options?.search,
        includeStale: options?.includeStale || false,
      });
    }

    return result.patterns || [];
  }

  /**
   * Get memory health statistics.
   */
  async health(): Promise<MemoryHealth> {
    let result: any;

    if (this.transport === "rest") {
      result = await this.restCall("GET", `/v1/memory/${this.programId}/health`);
    } else {
      result = await this.mcpCall("memory_health", { programId: this.programId });
    }

    return result.health;
  }

  /**
   * Delete a memory pattern by ID.
   */
  async delete(patternId: string): Promise<void> {
    if (this.transport === "rest") {
      await this.restCall("DELETE", `/v1/memory/${this.programId}/patterns/${patternId}`);
    } else {
      await this.mcpCall("delete_memory", { programId: this.programId, patternId });
    }
  }

  /**
   * Reinforce an existing pattern — bumps lastReinforced, optionally updates confidence/evidence.
   */
  async reinforce(patternId: string, options?: ReinforceOptions): Promise<void> {
    if (this.transport === "rest") {
      await this.restCall("PATCH", `/v1/memory/${this.programId}/patterns/${patternId}/reinforce`, {
        confidence: options?.confidence,
        evidence: options?.evidence,
      });
    } else {
      await this.mcpCall("reinforce_memory", {
        programId: this.programId,
        patternId,
        confidence: options?.confidence,
        evidence: options?.evidence,
      });
    }
  }

  /**
   * Call a tool via REST transport.
   */
  private async restCall(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
    const url = `${this.endpoint}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };

    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data: RESTResponse = await response.json();

    if (!data.success) {
      throw new Error(`API error: ${data.error?.message || "Unknown error"}`);
    }

    return data.data;
  }

  /**
   * Call an MCP tool via JSON-RPC transport.
   */
  private async mcpCall(name: string, args: Record<string, unknown>): Promise<any> {
    const request: MCPRequest = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name, arguments: args },
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

    const textContent = data.result.content[0]?.text;
    if (!textContent) {
      throw new Error("MCP response missing content");
    }

    const parsed = JSON.parse(textContent);
    if (!parsed.success) {
      throw new Error(`Tool error: ${parsed.error || "Unknown error"}`);
    }

    return parsed;
  }
}
