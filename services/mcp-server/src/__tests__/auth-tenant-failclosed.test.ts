/**
 * RD-5 PR-E, amendment 4 ruling 2: validateAuth denies when resolveTenant throws. Never an empty result,
 * never the raw uid. One structured log line; one alert per window.
 */

const sendAlertHandler = jest.fn(async () => ({}));
jest.mock("../firebase/client", () => ({ getFirestore: jest.fn(() => ({})) }));
jest.mock("../modules/signal", () => ({ sendAlertHandler }));
jest.mock("../auth/firebaseAuthValidator", () => ({ validateFirebaseToken: jest.fn(), isFirebaseToken: () => false }));
jest.mock("../auth/oauthTokenValidator", () => ({ validateOAuthToken: jest.fn(), isOAuthToken: () => false }));
jest.mock("../encryption/crypto", () => ({ deriveEncryptionKey: () => Buffer.alloc(32) }));
jest.mock("../middleware/capabilities", () => ({ getDefaultCapabilities: () => ["*"] }));
const mockResolve = jest.fn();
jest.mock("../auth/tenant-resolver", () => ({
  ...jest.requireActual("../auth/tenant-resolver"),
  resolveTenant: (...a: unknown[]) => mockResolve(...a),
}));

import { validateAuth, resetTenantAlertThrottle, TenantResolutionError } from "../auth/authValidator";
import { getFirestore } from "../firebase/client";

function keyDb() {
  return {
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ userId: "T0NWeYZI", programId: "dispatcher", active: true, capabilities: ["*"] }) }),
      update: async () => {},
    }),
  };
}

describe("validateAuth with a failing tenant lookup", () => {
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    resetTenantAlertThrottle();
    (getFirestore as jest.Mock).mockReturnValue(keyDb());
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it("denies with a retryable TenantResolutionError and never returns an auth context", async () => {
    mockResolve.mockRejectedValue(new TenantResolutionError("T0NWeYZI", new Error("unavailable")));
    await expect(validateAuth("cb_test")).rejects.toMatchObject({ name: "TenantResolutionError", retryable: true });
  });

  it("wraps a non-typed failure the same way", async () => {
    mockResolve.mockRejectedValue(new Error("boom"));
    await expect(validateAuth("cb_test")).rejects.toBeInstanceOf(TenantResolutionError);
  });

  it("logs one structured line per failure", async () => {
    mockResolve.mockRejectedValue(new TenantResolutionError("T0NWeYZI", new Error("x")));
    await validateAuth("cb_test").catch(() => {});
    const lines = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("TENANT_RESOLUTION_FAILED"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "TENANT_RESOLUTION_FAILED", programId: "dispatcher" });
  });

  it("alerts once per window", async () => {
    mockResolve.mockRejectedValue(new TenantResolutionError("T0NWeYZI", new Error("x")));
    for (let i = 0; i < 5; i++) await validateAuth("cb_test").catch(() => {});
    expect(sendAlertHandler).toHaveBeenCalledTimes(1);
  });

  it("control: a working lookup returns the canonical tenant", async () => {
    mockResolve.mockResolvedValue({ tenantId: "7viFKVtl", canonical: false, mergedFrom: "T0NWeYZI" });
    const a = await validateAuth("cb_test");
    expect(a?.userId).toBe("7viFKVtl");
  });
});
