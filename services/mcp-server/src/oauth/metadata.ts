/**
 * OAuth 2.1 Authorization Server Metadata
 * GET /.well-known/oauth-authorization-server  (RFC 8414)
 * GET /.well-known/oauth-protected-resource    (RFC 9728)
 *
 * Returns static JSON. Issuer derived from OAUTH_ISSUER env var or request Host header.
 */

import type http from "http";

function getIssuer(req: http.IncomingMessage): string {
  if (process.env.OAUTH_ISSUER) {
    return process.env.OAUTH_ISSUER;
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  return `${proto}://${host}`;
}

export function handleOAuthMetadata(req: http.IncomingMessage, res: http.ServerResponse): void {
  const issuer = getIssuer(req);

  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp:full", "mcp:read", "mcp:write", "mcp:admin"],
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  });
  res.end(JSON.stringify(metadata));
}

/**
 * Protected Resource Metadata (RFC 9728) — advertised via the WWW-Authenticate
 * resource_metadata hint on 401s from /v1/mcp. Points OAuth-capable clients
 * (claude.ai web/mobile connectors) at this authorization server.
 */
export function handleOAuthProtectedResource(req: http.IncomingMessage, res: http.ServerResponse): void {
  const issuer = getIssuer(req);

  const metadata = {
    resource: `${issuer}/v1/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:full", "mcp:read", "mcp:write", "mcp:admin"],
    resource_name: "CacheBash MCP",
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  });
  res.end(JSON.stringify(metadata));
}
