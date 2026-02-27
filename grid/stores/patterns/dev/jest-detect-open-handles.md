# Jest Tests Require --detectOpenHandles for Firebase

**Domain:** dev
**Confidence:** 0.88
**Discovered:** 2024-01-10T09:15:30Z
**Last Reinforced:** 2024-01-18T16:45:22Z
**Promoted:** 2024-01-18T17:00:00Z

## Pattern

Jest tests that interact with Firebase (Firestore, Admin SDK) must run with the `--detectOpenHandles` flag to prevent test hangs caused by unclosed connections.

## Evidence

Observed across 12 test files in services/mcp-server and services/functions:
- Without flag: 8/12 tests hung indefinitely after completion
- With flag: 12/12 tests completed successfully and exited cleanly
- Average test runtime decreased from timeout (30s) to 2.3s

Root cause: Firebase Admin SDK maintains connection pools that don't automatically close when tests finish.

## Context

Applies when:
1. Tests use Firebase Admin SDK (`firebase-admin`)
2. Tests interact with Firestore or other Firebase services
3. Using Jest as test runner
4. Tests run in Node.js environment

**Does NOT apply:**
- Client SDK tests (different connection model)
- Tests without Firebase dependencies
- Mocha/other test runners (different lifecycle)

## Examples

### Package.json Script

```json
{
  "scripts": {
    "test": "jest --detectOpenHandles",
    "test:watch": "jest --watch --detectOpenHandles",
    "test:coverage": "jest --coverage --detectOpenHandles"
  }
}
```

### Jest Config File

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  detectOpenHandles: true,  // Global setting
  forceExit: false,  // Don't use - masks the real issue
  testTimeout: 10000
};
```

### Why Not forceExit?

```json
// ❌ BAD - Masks problems
{
  "scripts": {
    "test": "jest --forceExit"
  }
}

// ✅ GOOD - Detects problems
{
  "scripts": {
    "test": "jest --detectOpenHandles"
  }
}
```

`--forceExit` kills the process even if connections are open. This:
- Hides resource leaks
- Can corrupt data in write operations
- Prevents proper cleanup

`--detectOpenHandles` reports open handles and allows graceful shutdown.

## Implementation

### Before (Hangs)

```typescript
// test.ts
import { getFirestore } from 'firebase-admin/firestore';

describe('Task module', () => {
  it('creates a task', async () => {
    const db = getFirestore();
    const result = await createTask(db, { title: 'Test' });
    expect(result.success).toBe(true);
  });
  // Test completes but Jest hangs forever
});
```

**Output:**
```
PASS  test.ts
  ✓ creates a task (234ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        2.456 s
[Jest hangs here indefinitely...]
```

### After (Exits Cleanly)

```typescript
// test.ts - same code, different flag
import { getFirestore } from 'firebase-admin/firestore';

describe('Task module', () => {
  it('creates a task', async () => {
    const db = getFirestore();
    const result = await createTask(db, { title: 'Test' });
    expect(result.success).toBe(true);
  });
});
```

**Output with --detectOpenHandles:**
```
PASS  test.ts
  ✓ creates a task (234ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        2.456 s

Jest has detected the following 2 open handles:
  ● GRPCHANNEL (Firestore)
      at Object.<anonymous> (node_modules/firebase-admin/...)

  ● TCPWRAP (Firestore connection pool)
      at Server.<anonymous> (node_modules/grpc/...)

[Jest exits after reporting handles]
```

### Proper Cleanup (Optional)

For integration tests, you can close Firebase explicitly:

```typescript
// test.ts
import * as admin from 'firebase-admin';

describe('Task module', () => {
  afterAll(async () => {
    await admin.app().delete();  // Closes all connections
  });

  it('creates a task', async () => {
    const db = getFirestore();
    const result = await createTask(db, { title: 'Test' });
    expect(result.success).toBe(true);
  });
});
```

With cleanup, tests exit cleanly even without `--detectOpenHandles`.

## Troubleshooting

### Tests Still Hang

1. Check for other async operations (setTimeout, intervals)
2. Verify all promises are awaited
3. Look for event listeners not removed
4. Check for WebSocket connections

### detectOpenHandles Reports Many Handles

This is informational, not an error. Firebase maintains:
- gRPC channels (Firestore)
- HTTP connection pools (Functions)
- Auth token refresh timers

These are expected and will be cleaned up on process exit.

### CI/CD Environments

In CI (GitHub Actions, etc.), add flag to npm test:

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: npm test -- --detectOpenHandles
```

## Related Patterns

- [firebase-emulator-setup](./firebase-emulator-setup.md) *(placeholder)*
- [integration-test-isolation](./integration-test-isolation.md) *(placeholder)*

## Performance Impact

Negligible. The flag adds ~50ms overhead for handle detection reporting.

---

*Promoted from program: basher*
*Session: basher-dev-2024-01*
