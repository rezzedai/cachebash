import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CacheBashMemory } from "../client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function restResponse(data: any, success = true) {
  return new Response(JSON.stringify({ success, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function restError(status: number, text: string) {
  return new Response(text, { status, statusText: text });
}

function mcpResponse(result: any) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      result: {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }],
      },
      id: 1,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function mcpErrorResponse(code: number, message: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: 1 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const defaultConfig = {
  apiKey: "test-api-key",
  programId: "test-program",
  transport: "rest" as const,
};

const mcpConfig = {
  apiKey: "test-api-key",
  programId: "test-program",
  transport: "mcp" as const,
};

describe("CacheBashMemory", () => {
  let client: CacheBashMemory;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new CacheBashMemory(defaultConfig);
  });

  // --- store() tests ---

  describe("store()", () => {
    it("stores a pattern successfully", async () => {
      mockFetch.mockResolvedValueOnce(restResponse(null));

      await client.store({
        id: "p-001",
        domain: "testing",
        pattern: "Always mock fetch",
        confidence: 0.9,
        evidence: "Works every time",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.cachebash.dev/v1/memory/test-program/patterns");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.pattern.id).toBe("p-001");
      expect(body.pattern.domain).toBe("testing");
      expect(body.pattern.confidence).toBe(0.9);
      expect(body.pattern.stale).toBe(false);
      expect(body.pattern.promotedToStore).toBe(false);
    });

    it("handles missing required fields", () => {
      // TypeScript enforces required fields at compile time,
      // but we test that the client sends what it receives
      expect(() => new CacheBashMemory({ apiKey: "", programId: "p" } as any)).toThrow(
        "apiKey is required"
      );
      expect(() => new CacheBashMemory({ apiKey: "k", programId: "" } as any)).toThrow(
        "programId is required"
      );
    });

    it("handles 401 API error", async () => {
      mockFetch.mockResolvedValueOnce(restError(401, "Unauthorized"));

      await expect(
        client.store({
          id: "p-001",
          domain: "testing",
          pattern: "test",
          confidence: 0.5,
          evidence: "test",
        })
      ).rejects.toThrow("HTTP 401");
    });

    it("handles 403 API error", async () => {
      mockFetch.mockResolvedValueOnce(restError(403, "Forbidden"));

      await expect(
        client.store({
          id: "p-001",
          domain: "testing",
          pattern: "test",
          confidence: 0.5,
          evidence: "test",
        })
      ).rejects.toThrow("HTTP 403");
    });

    it("handles 500 API error", async () => {
      mockFetch.mockResolvedValueOnce(restError(500, "Internal Server Error"));

      await expect(
        client.store({
          id: "p-001",
          domain: "testing",
          pattern: "test",
          confidence: 0.5,
          evidence: "test",
        })
      ).rejects.toThrow("HTTP 500");
    });

    it("handles network timeouts", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fetch failed: network timeout"));

      await expect(
        client.store({
          id: "p-001",
          domain: "testing",
          pattern: "test",
          confidence: 0.5,
          evidence: "test",
        })
      ).rejects.toThrow("network timeout");
    });
  });

  // --- recall() tests ---

  describe("recall()", () => {
    it("recalls all patterns (no filters)", async () => {
      const patterns = [
        {
          id: "p-001",
          domain: "testing",
          pattern: "test pattern",
          confidence: 0.9,
          evidence: "evidence",
          discoveredAt: "2026-01-01T00:00:00Z",
          lastReinforced: "2026-01-01T00:00:00Z",
          promotedToStore: false,
          stale: false,
        },
      ];
      mockFetch.mockResolvedValueOnce(restResponse({ patterns }));

      const result = await client.recall();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p-001");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.cachebash.dev/v1/memory/test-program/patterns");
    });

    it("filters by domain", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall({ domain: "security" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("domain=security");
    });

    it("filters by text search", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall({ search: "validate" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("query=validate");
    });

    it("excludes stale patterns by default", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall();

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("includeStale");
    });

    it("includes stale patterns when includeStale: true", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall({ includeStale: true });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("includeStale=true");
    });

    it("returns empty array when no patterns match", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      const result = await client.recall({ domain: "nonexistent" });

      expect(result).toEqual([]);
    });

    it("handles API errors", async () => {
      mockFetch.mockResolvedValueOnce(restError(500, "Internal Server Error"));

      await expect(client.recall()).rejects.toThrow("HTTP 500");
    });
  });

  // --- health() tests ---

  describe("health()", () => {
    it("returns health stats", async () => {
      const health = {
        totalPatterns: 42,
        activePatterns: 40,
        promotedPatterns: 5,
        stalePatterns: 2,
        domains: ["workflow", "security"],
        lastUpdatedAt: "2026-01-01T00:00:00Z",
        lastUpdatedBy: "test-program",
        decay: {
          maxUnpromotedPatterns: 200,
          learnedPatternMaxAge: 90,
          lastDecayRun: null,
        },
      };
      mockFetch.mockResolvedValueOnce(restResponse({ health }));

      const result = await client.health();

      expect(result.totalPatterns).toBe(42);
      expect(result.activePatterns).toBe(40);
      expect(result.domains).toContain("workflow");
    });

    it("handles API errors", async () => {
      mockFetch.mockResolvedValueOnce(restError(401, "Unauthorized"));

      await expect(client.health()).rejects.toThrow("HTTP 401");
    });
  });

  // --- delete() tests ---

  describe("delete()", () => {
    it("deletes by pattern ID", async () => {
      mockFetch.mockResolvedValueOnce(restResponse(null));

      await client.delete("p-001");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.cachebash.dev/v1/memory/test-program/patterns/p-001");
      expect(opts.method).toBe("DELETE");
    });

    it("handles 404 (pattern not found)", async () => {
      mockFetch.mockResolvedValueOnce(restError(404, "Not Found"));

      await expect(client.delete("nonexistent")).rejects.toThrow("HTTP 404");
    });
  });

  // --- reinforce() tests ---

  describe("reinforce()", () => {
    it("reinforces with updated confidence", async () => {
      mockFetch.mockResolvedValueOnce(restResponse(null));

      await client.reinforce("p-001", { confidence: 0.95 });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://api.cachebash.dev/v1/memory/test-program/patterns/p-001/reinforce"
      );
      expect(opts.method).toBe("PATCH");
      const body = JSON.parse(opts.body);
      expect(body.confidence).toBe(0.95);
    });

    it("reinforces with new evidence", async () => {
      mockFetch.mockResolvedValueOnce(restResponse(null));

      await client.reinforce("p-001", { evidence: "New observation" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.evidence).toBe("New observation");
    });

    it("handles 404", async () => {
      mockFetch.mockResolvedValueOnce(restError(404, "Not Found"));

      await expect(client.reinforce("nonexistent", { confidence: 0.5 })).rejects.toThrow(
        "HTTP 404"
      );
    });
  });

  // --- Transport tests ---

  describe("REST transport", () => {
    it("constructs correct URLs", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall({ domain: "test" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://api.cachebash.dev/v1/memory/test-program/patterns?domain=test"
      );
    });

    it("sends correct headers", async () => {
      mockFetch.mockResolvedValueOnce(restResponse({ patterns: [] }));

      await client.recall();

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["Authorization"]).toBe("Bearer test-api-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("MCP transport", () => {
    let mcpClient: CacheBashMemory;

    beforeEach(() => {
      mcpClient = new CacheBashMemory(mcpConfig);
    });

    it("sends correct JSON-RPC calls", async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse({ patterns: [] }));

      await mcpClient.recall({ domain: "test" });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.cachebash.dev/v1/mcp");
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("tools/call");
      expect(body.params.name).toBe("recall_memory");
      expect(body.params.arguments.programId).toBe("test-program");
      expect(body.params.arguments.domain).toBe("test");
    });

    it("handles MCP error responses", async () => {
      mockFetch.mockResolvedValueOnce(mcpErrorResponse(-32600, "Invalid request"));

      await expect(mcpClient.recall()).rejects.toThrow("MCP error -32600");
    });

    it("sends correct headers", async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse({ patterns: [] }));

      await mcpClient.recall();

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["Authorization"]).toBe("Bearer test-api-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });
  });
});
