/**
 * OAuth 2.1 Authorization Server Metadata
 * GET /.well-known/oauth-authorization-server
 *
 * Returns static JSON per RFC 8414.
 * Issuer derived from OAUTH_ISSUER env var or request Host header.
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
