# GitHub Actions Workflows

## ci.yml - Continuous Integration

**Triggers:** Push to main, Pull requests to main

**What it does:**
- Runs unit tests on services/mcp-server
- Runs integration tests with Firestore emulator
- Validates TypeScript builds

**Environment:**
- Node.js 20
- Java 21 (for Firebase emulator)
- Ubuntu latest

## publish.yml - npm Package Publishing

**Triggers:** Git tags matching `v*.*.*` (e.g., v1.0.0, v2.1.3)

**What it does:**
1. Validates tag format
2. Runs full test suite
3. Builds TypeScript
4. Updates package.json version to match tag
5. Publishes @cachebash/mcp-server to npm
6. Creates GitHub release

**Required Secrets:**
- `NPM_TOKEN` - npm access token with publish permissions

**Usage:**
```bash
# 1. Update version in your branch
npm version patch  # or minor, major

# 2. Commit and push
git add .
git commit -m "chore: release v1.0.1"
git push

# 3. Create and push tag
git tag v1.0.1
git push origin v1.0.1

# 4. GitHub Action automatically publishes to npm
```

**NPM_TOKEN Setup:**
1. Create npm access token at https://www.npmjs.com/settings/tokens
2. Choose "Automation" token type
3. Add to GitHub: Settings → Secrets → Actions → New repository secret
4. Name: `NPM_TOKEN`
5. Value: your npm token

## Permissions

Both workflows use minimal required permissions:
- `ci.yml`: Default read permissions
- `publish.yml`:
  - `contents: write` (for creating GitHub releases)
  - `id-token: write` (for npm provenance)
