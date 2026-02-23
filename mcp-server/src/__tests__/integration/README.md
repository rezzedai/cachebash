# Integration Tests

Integration tests for CacheBash MCP server that run against the Firestore emulator.

## Prerequisites

1. **Firebase CLI** installed:
   ```bash
   npm install -g firebase-tools
   ```

2. **Firestore Emulator** running:
   ```bash
   npx firebase emulators:start --only firestore
   ```

   The emulator will start on `localhost:8080` by default.

## Running Tests

### Start the emulator

In a separate terminal window:

```bash
cd /Users/christianbourlier/1P\ projects/cachebash/firebase
npx firebase emulators:start --only firestore
```

### Run integration tests

```bash
cd /Users/christianbourlier/1P\ projects/cachebash/mcp-server
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test:integration
```

Or set the environment variable globally:

```bash
export FIRESTORE_EMULATOR_HOST=localhost:8080
npm run test:integration
```

## Test Suites

1. **task-lifecycle.test.ts** - Full task lifecycle (create, claim, complete, TTL, budget)
2. **relay-delivery.test.ts** - Relay message delivery, status transitions, multicast, idempotency
3. **sprint-execution.test.ts** - Sprint lifecycle, story transitions, wave progression
4. **health-monitoring.test.ts** - GRIDBOT health checks, indicator thresholds, alert routing
5. **github-reconcile.test.ts** - GitHub sync queue processing, retry logic, max retry abandonment

## Architecture

- **Setup utilities** (`setup.ts`):
  - `getTestFirestore()` - Returns Firestore instance pointed at emulator
  - `clearFirestoreData()` - Clears all data between tests
  - `seedTestUser(userId)` - Creates test user with API key
  - `seedTestData(userId, collection, docs)` - Bulk insert test documents

- **Environment**:
  - `FIRESTORE_EMULATOR_HOST=localhost:8080` - Points Firebase Admin SDK to emulator
  - Project ID: `cachebash-app` (matches production)

## CI/CD Notes

For CI environments:

1. Start emulator in background:
   ```bash
   npx firebase emulators:start --only firestore --project cachebash-app &
   sleep 5  # Wait for emulator to be ready
   ```

2. Run tests with environment variable:
   ```bash
   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test:integration
   ```

3. Kill emulator after tests:
   ```bash
   pkill -f "firebase emulators"
   ```

## Debugging

- **Emulator UI**: http://localhost:4000 (when emulator is running)
- **Clear all data**: `curl -X DELETE "http://localhost:8080/emulator/v1/projects/cachebash-app/databases/(default)/documents"`
- **Check emulator status**: `curl http://localhost:8080`

## Differences from Unit Tests

- **Unit tests** (`npm test`): Fast, mocked dependencies, no external services
- **Integration tests** (`npm run test:integration`): Slower, real Firestore operations, requires emulator

Both test suites are independent and should pass separately.
