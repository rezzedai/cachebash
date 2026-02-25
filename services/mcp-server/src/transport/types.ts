export interface TransportConfig {
  sessionTimeout: number;
  enableDnsRebindingProtection: boolean;
  strictAcceptHeader: boolean;
  responseQueueTimeout: number;
  allowedOrigins?: string[];
}

export interface ParsedRequest {
  method: string;
  sessionId?: string;
  contentType?: string;
  accept?: string;
  host?: string;
  origin?: string;
  body: string | null;
  headers: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  authContext?: { userId: string; encryptionKey?: Buffer };
  lastActivity: number;
  protocolVersion?: string;
  createdAt: number;
}

export interface SessionValidation {
  valid: boolean;
  error?: string;
  session?: SessionInfo;
}
