import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { SessionManager } from "./SessionManager.js";
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
  public sessionId?: string;

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
        default:
          return this.toResponse(jsonRpcError(-32601, `Method not allowed: ${parsed.method}`, null));
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
        return this.toResponse(jsonRpcError(-32001, `Session expired or invalid: ${validation.error}. Use REST API fallback: POST https://cachebash-mcp-922749444863.us-central1.run.app/v1/{tool_name} with Bearer auth. See /v1/health for status.`, null));
      }
      session = validation.session!;
      this.sessionId = session.sessionId;
    }

    this.pendingResponses.delete(this.sessionId);
    for (const msg of messages) {
      this.onmessage?.(msg);
    }

    const maxWait = this.config.responseQueueTimeout || 2000;
    const start = Date.now();
    let responses: JSONRPCMessage[] = [];
    while (Date.now() - start < maxWait) {
      responses = this.pendingResponses.get(this.sessionId) || [];
      if (responses.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    this.pendingResponses.delete(this.sessionId);

    if (responses.length === 0) {
      return new Response(null, { status: 204, headers: { "Mcp-Session-Id": this.sessionId } });
    }
    const payload = responses.length === 1 ? responses[0] : responses;
    return this.toResponse(jsonResponse(payload, 200, this.sessionId));
  }

  private async handleDelete(
    parsed: ParsedRequest,
    authContext?: { userId: string; encryptionKey?: Buffer }
  ): Promise<Response> {
    if (!authContext) return this.toResponse(unauthorizedResponse("Missing authentication"));
    if (!parsed.sessionId) {
      return this.toResponse(jsonRpcError(-32600, "Mcp-Session-Id header is required", null));
    }
    await this.sessionManager.deleteSession(parsed.sessionId, authContext.userId);
    return new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  private toResponse(tr: TransportResponse): Response {
    return new Response(tr.body, { status: tr.status, headers: tr.headers });
  }
}
