/**
 * keyIndex.lastUsedAt is written at most once a minute per key.
 *
 * It was written on every authenticated request, which made it one Firestore
 * write per call for the fleet's busiest caller (the dispatcher polls every
 * few seconds). Its only reader asks "used in the last 7 days".
 */

const update = jest.fn(() => Promise.resolve());
let keyData: Record<string, unknown> = {};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: jest.fn(async () => ({ exists: true, data: () => keyData })),
      update,
    })),
  })),
}));

import { validateApiKey } from "../auth/authValidator.js";

// Local copy of the interval rather than an import, so this file also runs
// (and must fail) against the pre-throttle validator.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

function tsMsAgo(ms: number) {
  const at = Date.now() - ms;
  return { toMillis: () => at, toDate: () => new Date(at) };
}

beforeEach(() => {
  update.mockClear();
  keyData = { userId: "u1", programId: "dispatcher", capabilities: ["*"] };
});

describe("keyIndex.lastUsedAt write throttle", () => {
  it("skips the write when the key was used within the interval", async () => {
    keyData.lastUsedAt = tsMsAgo(5_000);
    const auth = await validateApiKey("cb_test_key");
    expect(auth?.userId).toBe("u1");
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when the last use is older than the interval", async () => {
    keyData.lastUsedAt = tsMsAgo(LAST_USED_WRITE_INTERVAL_MS + 1_000);
    await validateApiKey("cb_test_key");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("writes when the key has never recorded a use", async () => {
    await validateApiKey("cb_test_key");
    expect(update).toHaveBeenCalledTimes(1);
  });
});
