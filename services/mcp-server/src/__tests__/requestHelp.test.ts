/**
 * request_help tool — unit tests.
 *
 * Verifies:
 *   1. Handler sends correct MCP handshake sequence (initialize → notifications/initialized → tools/call)
 *   2. Payload carries tenant stamp for home-grid routing
 *   3. target=grid-help, source=rezzed.agent, message_type=DIRECTIVE
 *   4. Returns Sayf-facing lexicon string + correlationId
 *   5. Session is reused across calls (no re-handshake)
 *   6. Re-handshakes on 401
 *   7. Missing REZZED_AGENT_KEY throws clearly (misconfiguration)
 *   8. request_help absent from full profile, present in lite profile
 */

// Break ESM chains (@octokit/rest is ESM-only; Jest cannot parse it without these mocks)
jest.mock("../modules/github-sync", () => ({}));
jest.mock("../tools/feedback", () => ({ handlers: {}, definitions: [] }));

import { requestHelpHandler, _setFetchFn } from "../modules/requestHelp";
import { TOOL_DEFINITIONS } from "../tools/index";

// ── Mock fetch helpers ────────────────────────────────────────────────────────

interface MockCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function makeMcpFetch({
  sessionId = "test-sid-001",
  toolsCallStatus = 200,
  rejectOn = null as string | null,
} = {}) {
  const calls: MockCall[] = [];
  const fn = async (url: string, opts: RequestInit) => {
    const body = opts?.body ? JSON.parse(opts.body as string) : {};
    calls.push({
      url,
      method: opts?.method as string,
      body,
      headers: (opts?.headers ?? {}) as Record<string, string>,
    });

    if (rejectOn && body.method === rejectOn) {
      throw new Error("ECONNREFUSED");
    }

    if (body.method === "initialize") {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === "mcp-session-id" ? sessionId : null,
        },
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      } as unknown as Response;
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        status: 202,
        headers: { get: () => null },
        text: async () => "",
      } as unknown as Response;
    }
    if (body.method === "tools/call") {
      return {
        ok: toolsCallStatus < 400,
        status: toolsCallStatus,
        headers: { get: () => null },
        text: async () =>
          toolsCallStatus < 400
            ? JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [] } })
            : "error",
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => "unexpected",
    } as unknown as Response;
  };
  fn.calls = calls;
  return fn;
}

const fakeAuth = {} as any;

beforeEach(() => {
  process.env.REZZED_AGENT_KEY = "cb_testrelaykey00000000000000000000000000000";
  process.env.CACHEBASH_TENANT_ID = "cerebro";
  process.env.HOME_GRID_MCP = "https://api.cachebash.dev/v1/mcp";
});

afterEach(() => {
  delete process.env.REZZED_AGENT_KEY;
  _setFetchFn(globalThis.fetch);
});

// ── MCP handshake sequence ────────────────────────────────────────────────────

describe("MCP handshake", () => {
  it("does 3-step sequence on first call: initialize → notifications/initialized → tools/call", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "email fetch failed", loopId: "morning-queue" });
    // Give the async fire-and-forget a tick to run
    await new Promise((r) => setImmediate(r));

    const methods = mockFetch.calls.map((c) => c.body.method);
    expect(methods[0]).toBe("initialize");
    expect(methods[1]).toBe("notifications/initialized");
    expect(methods[2]).toBe("tools/call");
    expect(mockFetch.calls).toHaveLength(3);
  });

  it("passes Mcp-Session-Id header to tools/call", async () => {
    const SID = "sid-abc-123";
    const mockFetch = makeMcpFetch({ sessionId: SID });
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "test" });
    await new Promise((r) => setImmediate(r));

    const toolsCall = mockFetch.calls.find((c) => c.body.method === "tools/call");
    expect(toolsCall?.headers["Mcp-Session-Id"]).toBe(SID);
  });

  it("reuses session across calls — no re-handshake on second call", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "first" });
    await new Promise((r) => setImmediate(r));
    await requestHelpHandler(fakeAuth, { symptom: "second" });
    await new Promise((r) => setImmediate(r));

    // First: 3 calls. Second: 1 (tools/call only).
    expect(mockFetch.calls).toHaveLength(4);
    expect(mockFetch.calls[3].body.method).toBe("tools/call");
  });

  it("re-handshakes on 401 and retries tools/call", async () => {
    let callCount = 0;
    const mockFetch = async (url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      callCount++;
      if (body.method === "initialize") {
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => h.toLowerCase() === "mcp-session-id" ? "new-sid" : null },
          text: async () => "{}",
        } as unknown as Response;
      }
      if (body.method === "notifications/initialized") {
        return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" } as unknown as Response;
      }
      if (body.method === "tools/call") {
        // First tools/call returns 401; after re-handshake it succeeds
        if (callCount <= 3) {
          return { ok: false, status: 401, headers: { get: () => null }, text: async () => "unauthorized" } as unknown as Response;
        }
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" } as unknown as Response;
      }
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => "" } as unknown as Response;
    };
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "session expired" });
    await new Promise((r) => setImmediate(r));
    // 3 (first handshake+call) + 3 (re-handshake + retry call)
    expect(callCount).toBe(6);
  });
});

// ── Payload ───────────────────────────────────────────────────────────────────

describe("relay payload", () => {
  it("sets source=rezzed.agent, target=grid-help, message_type=DIRECTIVE", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "x" });
    await new Promise((r) => setImmediate(r));

    const toolsCall = mockFetch.calls.find((c) => c.body.method === "tools/call");
    const callArgs = (toolsCall?.body as any)?.params?.arguments;
    expect(callArgs?.source).toBe("rezzed.agent");
    expect(callArgs?.target).toBe("grid-help");
    expect(callArgs?.message_type).toBe("DIRECTIVE");
  });

  it("stamps payload.tenant with CACHEBASH_TENANT_ID for home-grid routing", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, { symptom: "stuck" });
    await new Promise((r) => setImmediate(r));

    const toolsCall = mockFetch.calls.find((c) => c.body.method === "tools/call");
    const payload = (toolsCall?.body as any)?.params?.arguments?.payload;
    expect(payload?.tenant).toBe("cerebro");
  });

  it("carries symptom, loopId, context, and msgId in payload", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await requestHelpHandler(fakeAuth, {
      symptom: "transcript missing",
      loopId: "call-review",
      context: "third attempt",
    });
    await new Promise((r) => setImmediate(r));

    const toolsCall = mockFetch.calls.find((c) => c.body.method === "tools/call");
    const payload = (toolsCall?.body as any)?.params?.arguments?.payload;
    expect(payload?.symptom).toBe("transcript missing");
    expect(payload?.loopId).toBe("call-review");
    expect(payload?.context).toBe("third attempt");
    expect(typeof payload?.msgId).toBe("string");
  });
});

// ── Return value ──────────────────────────────────────────────────────────────

describe("return value", () => {
  it("returns sayf string with no grid jargon", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await requestHelpHandler(fakeAuth, { symptom: "x" });
    const jargon = ["dispatch", "derez", "worktree", "gsp", "iso", "vector", "tensor", "relay"];
    const found = jargon.filter((w) => result.sayf.toLowerCase().includes(w));
    expect(found).toHaveLength(0);
    expect(result.sayf).toContain("support");
  });

  it("returns a correlationId UUID", async () => {
    const mockFetch = makeMcpFetch();
    _setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await requestHelpHandler(fakeAuth, { symptom: "x" });
    expect(result.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

// ── Fire-and-forget safety ────────────────────────────────────────────────────

describe("fire-and-forget", () => {
  it("does not throw when egress returns 500", async () => {
    const mockFetch = makeMcpFetch({ toolsCallStatus: 500 });
    _setFetchFn(mockFetch as unknown as typeof fetch);

    await expect(
      requestHelpHandler(fakeAuth, { symptom: "x" })
    ).resolves.toBeDefined();
  });

  it("does not throw on network error", async () => {
    const errorFetch = async () => { throw new Error("ECONNREFUSED"); };
    _setFetchFn(errorFetch as unknown as typeof fetch);

    await expect(
      requestHelpHandler(fakeAuth, { symptom: "x" })
    ).resolves.toBeDefined();
  });
});

// ── Misconfiguration ──────────────────────────────────────────────────────────

describe("misconfiguration", () => {
  it("throws clearly when REZZED_AGENT_KEY is absent", async () => {
    delete process.env.REZZED_AGENT_KEY;
    await expect(
      requestHelpHandler(fakeAuth, { symptom: "x" })
    ).rejects.toThrow("REZZED_AGENT_KEY");
  });
});

// ── Profile gating ────────────────────────────────────────────────────────────

describe("profile gating", () => {
  it("request_help is absent from full-profile TOOL_DEFINITIONS when CACHEBASH_PROFILE=full", () => {
    // index.ts reads IS_LITE at module load time from CACHEBASH_PROFILE.
    // In CI the profile defaults to 'full'. This test verifies the guard works
    // by checking the currently-loaded definitions (process started without IS_LITE).
    const names = TOOL_DEFINITIONS.map((d: any) => d.name);
    // When running under full profile (CI default), request_help must be absent.
    // When running under lite profile, it must be present.
    const isLite = (process.env.CACHEBASH_PROFILE ?? "full") === "lite";
    if (isLite) {
      expect(names).toContain("request_help");
    } else {
      expect(names).not.toContain("request_help");
    }
  });
});
