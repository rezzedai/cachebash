# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in CacheBash, please report it responsibly.

**Email:** security@rezzed.ai

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 5 business days
- **Resolution target:** Within 30 days for critical issues

## Scope

This policy applies to:
- The CacheBash MCP server (`services/mcp-server/`)
- The CacheBash CLI (`packages/cli/`)
- Cloud Functions (`services/functions/`)
- Firebase security rules (`infra/`)

## Out of Scope

- The hosted service at api.cachebash.dev (report to security@rezzed.ai separately)
- Third-party dependencies (report to the upstream project)
- Social engineering attacks

## Disclosure Policy

We follow coordinated disclosure with a **90-day disclosure timeline**. Please do not publicly disclose vulnerabilities until:
- 90 days have passed since initial report, OR
- We've published a fix and confirmed it's safe to disclose

We credit reporters in our release notes unless anonymity is requested.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | Best effort |
