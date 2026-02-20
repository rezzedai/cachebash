# Contributing to CacheBash

Thanks for your interest in contributing to CacheBash. This guide covers how to set up your development environment, our coding standards, and the pull request process.

## Development Setup

### Prerequisites

- **Node.js 18+** and npm
- **Firebase CLI** (`npm install -g firebase-tools`)
- **gcloud CLI** (for deployment)
- **Flutter SDK** (if working on mobile app)
- **Git** with commit signing configured

### Clone and Install

```bash
# Clone repository
git clone https://github.com/rezzedai/cachebash.git
cd cachebash

# Install MCP server dependencies
cd mcp-server
npm install

# Install Cloud Functions dependencies
cd ../firebase/functions
npm install

# Install mobile app dependencies (optional)
cd ../../app
flutter pub get
```

### Local Development

#### MCP Server

```bash
cd mcp-server

# Build TypeScript
npm run build

# Start development server with watch mode
npm run dev

# In another terminal, test endpoints
curl http://localhost:3001/v1/health
```

#### Cloud Functions

```bash
cd firebase/functions

# Build
npm run build

# Run locally with Firebase emulator
firebase emulators:start --only functions,firestore

# Test function
curl http://localhost:5001/cachebash-app/us-central1/onTaskCreate
```

#### Mobile App

```bash
cd app

# Run on iOS simulator
flutter run -d ios

# Run on Android emulator
flutter run -d android
```

### Firebase Emulator Setup

Create `firebase.json` in project root:

```json
{
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "functions": {
      "port": 5001
    },
    "ui": {
      "enabled": true,
      "port": 4000
    }
  }
}
```

Start emulators:
```bash
firebase emulators:start
```

Point MCP server to emulator by setting env var:
```bash
export FIRESTORE_EMULATOR_HOST="localhost:8080"
npm run dev
```

## Coding Standards

### TypeScript Style

- **Imports:** Named imports preferred, group by external/internal
- **Types:** Explicit return types on all functions
- **Errors:** Use custom error classes (`RateLimitError`, `ValidationError`, etc.)
- **Async:** Prefer `async/await` over `.then()` chains
- **Naming:** camelCase for variables/functions, PascalCase for types/classes

**Example:**
```typescript
import { getFirestore } from "../firebase/client.js";
import type { AuthContext } from "../auth/apiKeyValidator.js";

export async function getTasks(
  authContext: AuthContext,
  filters: TaskFilters
): Promise<Task[]> {
  const db = getFirestore();
  const tasksRef = db.collection(`users/${authContext.userId}/tasks`);

  const snapshot = await tasksRef
    .where("status", "==", filters.status)
    .limit(filters.limit)
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
}
```

### File Organization

- **Modules:** One tool group per file (`modules/dispatch.ts`, `modules/relay.ts`)
- **Types:** Shared types in `types/`, module-specific types inline
- **Tests:** Co-located in `__tests__/` with `.test.ts` suffix
- **Exports:** Named exports only, no default exports

### Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**Examples:**
```
feat(relay): add multicast group support

Implements RFC-002 multicast groups (council, builders, intelligence, all).
Programs can now send messages to groups instead of individual targets.

Closes #42
```

```
fix(auth): prevent API key enumeration via timing attack

Add constant-time comparison for key hash lookup.
```

### Testing

Write tests for all new features and bug fixes.

```bash
cd mcp-server
npm test

# Watch mode
npm run test:watch
```

**Example test:**
```typescript
import { validateApiKey } from "../auth/apiKeyValidator";

describe("validateApiKey", () => {
  it("should return AuthContext for valid key", async () => {
    const key = "cb_test_validkey123";
    const context = await validateApiKey(key);

    expect(context).toBeDefined();
    expect(context?.userId).toBe("test-user-id");
    expect(context?.programId).toBe("iso");
  });

  it("should return null for invalid key", async () => {
    const key = "cb_test_invalidkey";
    const context = await validateApiKey(key);

    expect(context).toBeNull();
  });
});
```

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming:
- `feat/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation only
- `refactor/` — Code refactoring
- `test/` — Test improvements

### 2. Make Changes

- Write code following style guide
- Add tests for new functionality
- Update documentation if needed
- Test locally with emulators

### 3. Commit and Push

```bash
git add .
git commit -m "feat(module): description"
git push origin feat/your-feature-name
```

### 4. Open Pull Request

1. Go to GitHub repository
2. Click "New Pull Request"
3. Select your branch
4. Fill out PR template:

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Added X feature
- Fixed Y bug
- Refactored Z module

## Testing
- [ ] Unit tests added/updated
- [ ] Tested locally with emulators
- [ ] Tested against production (if applicable)

## Documentation
- [ ] Updated README.md
- [ ] Updated API docs
- [ ] Added code comments

## Checklist
- [ ] Code follows style guide
- [ ] Tests pass (`npm test`)
- [ ] No console.log() or debug code
- [ ] TypeScript builds without errors
- [ ] Firestore rules updated (if schema changes)
```

### 5. Code Review

- Address review feedback
- Push additional commits to same branch
- PR will auto-update

### 6. Merge

Once approved, PR will be merged by maintainer. Delete your branch after merge:

```bash
git checkout main
git pull origin main
git branch -d feat/your-feature-name
```

## Issue Guidelines

### Reporting Bugs

Use the bug report template:

```markdown
**Describe the bug**
Clear description of what's broken.

**To Reproduce**
1. Call tool X with parameters Y
2. Observe error Z

**Expected behavior**
What should have happened.

**Environment**
- CacheBash version: [e.g., 2.0.0]
- Node.js version: [e.g., 18.20.0]
- OS: [e.g., macOS 14.2]

**Logs**
```
Paste relevant logs here
```
```

### Feature Requests

Use the feature request template:

```markdown
**Problem**
What problem does this solve?

**Proposed Solution**
How would you implement this?

**Alternatives**
Other approaches considered.

**Additional Context**
Screenshots, diagrams, code examples.
```

## Architecture Decisions

For significant changes (new modules, schema changes, breaking changes), open an RFC (Request for Comments) issue first:

1. Create issue with `RFC:` prefix
2. Describe problem, proposed solution, alternatives
3. Tag maintainers for review
4. Wait for consensus before implementing

**Example:** `RFC: Add WebSocket transport for real-time session updates`

## Release Process

Maintainers only:

1. Update version in `mcp-server/package.json`
2. Update CHANGELOG.md
3. Tag release: `git tag v2.1.0`
4. Push tag: `git push origin v2.1.0`
5. Deploy to Cloud Run
6. Publish release notes on GitHub

## Questions?

- **General questions:** Open a GitHub Discussion
- **Bug reports:** Open a GitHub Issue
- **Security issues:** Email security@rezzed.ai (do not open public issue)
- **Contributing help:** Tag @rezzedai/maintainers in issue

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Built by [Rezzed.ai](https://rezzed.ai)
