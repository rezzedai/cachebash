import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { SessionManager } from "./SessionManager.js";
import { emitEvent } from "../modules/events.js";
import { TransportConfig, ParsedRequest, TransportResponse, SessionInfo } from "./types.js";
import { parseJsonBody, isInitializeRequest } from "./MessageParser.js";
import {
  jsonResponse,
  jsonRpcError,
  unauthorizedResponse,
  internalErrorResponse,
} from "./ResponseBuilder.js";
import { validateRequestHeaders } from "../security/dns-rebinding.js";

export class CustomHTTPTransport implements Transport {
  private config: TransportConfig;
  private sessionManager: SessionManager;
  private pendingResponses: Map<string, JSONRPCMessage[]> = new Map();
  private pendingResolvers: Map<string, () => void> = new Map();
  public sessionId?: string;

  /** Auth context for the current request — set per-request, read by tool handlers */
  public currentAuth: any | null = null;

  public onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  public onerror?: (error: Error) => void;
  public onclose?: () => void;

  constructor(config: TransportConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config.sessionTimeout);
  }

  async start(): Promise<void> {}
  async close(): Promise<void> { this.onclose?.(); }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.sessionId) throw new Error("Cannot send message: no active session");
    if (!this.pendingResponses.has(this.sessionId)) {
      this.pendingResponses.set(this.sessionId, []);
    }
    this.pendingResponses.get(this.sessionId)!.push(message);
    // Signal the waiting request immediately — no polling delay
    const resolver = this.pendingResolvers.get(this.sessionId);
    if (resolver) {
      this.pendingResolvers.delete(this.sessionId);
      resolver();
    }
  }

  async handleRequest(
    request: Request,
    authContext?: { userId: string; encryptionKey?: Buffer }
  ): Promise<Response> {
    try {
      const parsed = await this.parseRequest(request);
      const headerCheck = this.validateHeaders(parsed);
      if (!headerCheck.valid) return this.toResponse(headerCheck.response!);

      switch (parsed.method) {
        case "POST":
          return await this.handlePost(parsed, authContext);
        case "DELETE":
          return await this.handleDelete(parsed, authContext);
        case "GET":
          // MCP Streamable HTTP spec: clients send GET with Accept: text/event-stream
          // to open an SSE stream. We don't support SSE — return 405 so the client
          // skips SSE gracefully. Returning 200 with JSON here causes the client to
          // hang trying to parse JSON as an SSE event stream.
          return new Response(null, {
            status: 405,
            headers: { Allow: "POST, DELETE" },
          });
        default:
          return new Response(null, {
            status: 405,
            headers: { Allow: "POST, DELETE" },
          });
      }
    } catch (error) {
      return this.toResponse(internalErrorResponse(error instanceof Error ? error.message : String(error)));
    }
  }

  private async parseRequest(request: Request): Promise<ParsedRequest> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    let body: string | null = null;
    if (request.method === "POST") body = await request.text() || null;
    return {
      method: request.method,
      sessionId: headers["mcp-session-id"],
      contentType: headers["content-type"],
      accept: headers["accept"],
      host: headers["host"],
      origin: headers["origin"],
      body,
      headers,
    };
  }

  private validateHeaders(parsed: ParsedRequest): { valid: boolean; response?: TransportResponse } {
    if (this.config.enableDnsRebindingProtection) {
      const dns = validateRequestHeaders(parsed.host, parsed.origin, this.config.allowedOrigins);
      if (!dns.valid) return { valid: false, response: unauthorizedResponse(dns.error!) };
    }
    if (parsed.method === "POST" && !parsed.contentType?.includes("application/json")) {
      return { valid: false, response: jsonRpcError(-32600, "Content-Type must be application/json", null) };
    }
    return { valid: true };
  }

  private async handlePost(
    parsed: ParsedRequest,
    authContext?: { userId: string; encryptionKey?: Buffer }
  ): Promise<Response> {
    if (!authContext) return this.toResponse(unauthorizedResponse("Missing authentication"));

    const parseResult = parseJsonBody(parsed.body);
    if (!parseResult.success) {
      return this.toResponse(jsonRpcError(parseResult.error!.code, parseResult.error!.message, null));
    }

    const messages = Array.isArray(parseResult.message) ? parseResult.message : [parseResult.message!];
    const hasInit = messages.some((m) => isInitializeRequest(m));

    let session: SessionInfo;
    if (hasInit) {
      if (parsed.sessionId) {
        return this.toResponse(jsonRpcError(-32600, "Initialize must not include Mcp-Session-Id", null));
      }
      session = await this.sessionManager.createSession(authContext.userId, authContext);
      this.sessionId = session.sessionId;
    } else {
      if (!parsed.sessionId) {
        return this.toResponse(jsonRpcError(-32600, "Mcp-Session-Id header is required", null));
      }
      const validation = await this.sessionManager.validateSession(parsed.sessionId, authContext.userId);
      if (!validation.valid) {
        // Emit session death telemetry (keep for monitoring)
        emitEvent(authContext.userId, {
          event_type: "SESSION_DEATH",
          session_id: parsed.sessionId,
          program_id: (authContext as any).programId || "unknown",
        });
        console.warn(`[Transport] Session ${parsed.sessionId} invalid but proceeding with Bearer auth`);
        // DO NOT return error — auth comes from Bearer token, not session state
      }
      session = validation.session || { sessionId: parsed.sessionId, userId: authContext.userId, lastActivity: Date.now(), createdAt: Date.now() };
      this.sessionId = session.sessionId;

    // Heartbeat recognition: notifications/heartbeat refreshes session, returns immediately
    const isHeartbeat = messages.every((m: any) => m.method === "notifications/heartbeat");
    if (isHeartbeat) {
      // Update Firestore sessions document lastHeartbeat to prevent false stale session detection
      const db = (await import("../firebase/client.js")).getFirestore();
      const admin = await import("firebase-admin");
      await db.doc(`tenants/${authContext.userId}/sessions/${this.sessionId}`).update({
        lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err) => {
        // Session may not exist in sessions collection (e.g., MCP client without Grid program)
        // This is not an error — only Grid programs create entries in the sessions collection
        console.debug(`[Heartbeat] Session ${this.sessionId} not in sessions collection (expected for non-Grid MCP clients)`);
      });
      return new Response(null, { status: 204, headers: { "Mcp-Session-Id": this.sessionId } });
    }

    // Notification recognition: messages without an `id` field are fire-and-forget per JSON-RPC spec.
    // Accept immediately with 202, dispatch async. No response expected by the client.
    const allNotifications = messages.every((m: any) => !("id" in m));
    if (allNotifications) {
      this.currentAuth = authContext;
      for (const msg of messages) {
        this.onmessage?.(msg);
      }
      return new Response(null, { status: 202, headers: { "Mcp-Session-Id": this.sessionId } });
    }
    }

    // Set current auth for tool handler to read (stateless — derived from Bearer token this request)
    this.currentAuth = authContext;

    const sid = this.sessionId;
    this.pendingResponses.delete(sid);
    for (const msg of messages) {
      this.onmessage?.(msg);
    }

    // Wait for response via Promise — resolves immediately when send() fires,
    // falls back to timeout for fire-and-forget notifications
    const maxWait = this.config.responseQueueTimeout || 2000;
    await new Promise<void>((resolve) => {
      // Check if response already arrived (sync handler path)
      const existing = this.pendingResponses.get(sid);
      if (existing && existing.length > 0) { resolve(); return; }
      // Register resolver for send() to trigger
      this.pendingResolvers.set(sid, resolve);
      // Timeout fallback — return 204 for notifications that don't produce responses
      setTimeout(() => {
        this.pendingResolvers.delete(sid);
        resolve();
      }, maxWait);
    });

    const responses = this.pendingResponses.get(sid) || [];
    this.pendingResponses.delete(sid);

    if (responses.length === 0) {
      return new Response(null, { status: 204, headers: { "Mcp-Session-Id": sid } });
    }
    const payload = responses.length === 1 ? responses[0] : responses;
    return this.toResponse(jsonResponse(payload, 200, sid));
  }

  private async handleDelete(
    parsed: ParsedRequest,
    authContext?: { userId: string; encryptionKey?: Buffer }
  ): Promise<Response> {
    if (!authContext) return this.toResponse(unauthorizedResponse("Missing authentication"));
    if (!parsed.sessionId) {
      return this.toResponse(jsonRpcError(-32600, "Mcp-Session-Id header is required", null));
    }
    // Emit session ended telemetry
    emitEvent(authContext.userId, {
      event_type: "SESSION_ENDED",
      session_id: parsed.sessionId,
      program_id: (authContext as any).programId || "unknown",
    });
    await this.sessionManager.deleteSession(parsed.sessionId, authContext.userId);
    return new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  private toResponse(tr: TransportResponse): Response {
    return new Response(tr.body, { status: tr.status, headers: tr.headers });
  }
}
