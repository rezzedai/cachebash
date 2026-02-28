# GitHub Actions Workflows

## ci.yml - Continuous Integration

**Triggers:** Push to main, Pull requests to main

**Jobs:**
- **Typecheck** — `tsc --noEmit` on services/mcp-server
- **Test** — Jest unit tests on services/mcp-server
- **Build** — TypeScript compile on services/mcp-server

**Environment:** Node.js 18, Ubuntu latest

## publish.yml - npm Package Publishing

**Triggers:** Git tags matching `v*` (e.g., v1.0.0, v2.1.3)

**What it does:**
1. Validates tag format (v*.*.*)
2. Runs full test suite
3. Builds TypeScript
4. Updates package.json version to match tag
5. Publishes @cachebash/mcp-server to npm
6. Creates GitHub release with auto-generated notes

**Required Secrets:**
- `NPM_TOKEN` — npm access token with publish permissions (not yet configured)

**Usage:**
```bash
git tag v1.0.1
git push origin v1.0.1
# GitHub Action automatically publishes to npm
```
