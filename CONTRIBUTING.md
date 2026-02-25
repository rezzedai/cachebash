# Contributing to CacheBash

CacheBash is MIT licensed and contributions are welcome. This guide covers how to set up a development environment, submit changes, and what to expect during review.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- A Firebase project (free tier works for development)
- A Google Cloud service account key

### Development Setup

```bash
# Clone the repo
git clone https://github.com/rezzedai/cachebash.git
cd cachebash

# MCP Server
cd mcp-server
npm install
cp .env.example .env
# Edit .env with your Firebase credentials
npm run dev

# CLI Tool
cd ../cli
npm install
npm run dev

# Cloud Functions
cd ../firebase/functions
npm install
```

### Running Tests

```bash
# MCP Server tests
cd mcp-server
npm test

# Cloud Functions tests
cd firebase/functions
npm test
```

### Local Development with Firebase Emulator

```bash
# Start Firebase emulators (Firestore + Auth)
cd firebase
npx firebase emulators:start

# Point MCP server at emulator
# Set FIRESTORE_EMULATOR_HOST=localhost:8080 in .env
```

---

## How to Contribute

### Bug Reports

Open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, MCP client)

### Feature Requests

Open a GitHub Issue with the `feature-request` label. Describe:
- The problem you're trying to solve
- How you think CacheBash should solve it
- Any alternatives you've considered

### Pull Requests

1. Fork the repo
2. Create a branch from `main` (`git checkout -b fix/describe-the-change`)
3. Make your changes
4. Add tests for new functionality
5. Run the test suite (`npm test`)
6. Commit with a clear message describing what and why
7. Push and open a PR against `main`

### Branch Naming

- `fix/short-description` — bug fixes
- `feat/short-description` — new features
- `docs/short-description` — documentation changes
- `refactor/short-description` — code restructuring without behavior change

---

## What We Review For

- **Does it solve the stated problem?** Feature PRs should reference an issue.
- **Does it have tests?** New functionality needs test coverage.
- **Does it follow existing patterns?** Look at how similar features are implemented.
- **Is it focused?** One PR, one change. Don't bundle unrelated modifications.
- **Does it maintain backwards compatibility?** MCP tool signatures are public API.

---

## Architecture Overview

If you're contributing code, understand the module structure:

```
mcp-server/src/
├── modules/       # Business logic — one file per feature domain
├── middleware/     # Request pipeline — auth, rate limiting, usage
├── transport/     # Protocol handlers — MCP and REST
├── types/         # TypeScript types — shared across modules
└── auth/          # Authentication — API keys and Firebase Auth
```

**Adding a new MCP tool:**
1. Define the tool schema in `tools.ts`
2. Implement the handler in the appropriate module under `modules/`
3. Add types to `types/`
4. Add tests
5. Update the tool count in README if needed

**Adding a Cloud Function:**
1. Create the function in `firebase/functions/src/`
2. Export it from `firebase/functions/src/index.ts`
3. Add tests
4. Document any new Firestore collections or security rules

---

## Code Style

- TypeScript strict mode
- No `any` types without justification
- Descriptive variable names over comments
- Functions do one thing
- Error messages should help the user fix the problem

---

## Community

- [Documentation](https://docs.rezzed.ai)
- [GitHub Issues](https://github.com/rezzedai/cachebash/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/rezzedai/cachebash/discussions) — questions and ideas

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
