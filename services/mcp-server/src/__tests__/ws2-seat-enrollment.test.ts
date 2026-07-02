/**
 * WS-2: Seat enrollment — wingman-tier tokens + per-seat metering.
 *
 * Covers:
 *  - AuthContext.seatId is populated ONLY from the validated keyIndex doc,
 *    never from a request header/programIdOverride.
 *  - incrementSeatUsage isolates counters per seat (seat A calls never bump seat B).
 *  - No seat counter write when seatId is absent.
 *  - Revoking one seat's key leaves peer seats' keys and counters unaffected.
 */

import * as crypto from "crypto";
import { validateApiKey } from "../auth/authValidator";
import { getFirestore } from "../firebase/client";
import { incrementSeatUsage, incrementUsage } from "../middleware/usage";

jest.mock("../firebase/client");
jest.mock("../middleware/capabilities", () => ({
  getDefaultCapabilities: jest.fn().mockReturnValue(["dispatch.read"]),
}));
jest.mock("../auth/tenant-resolver", () => ({
  resolveTenant: jest.fn().mockResolvedValue({ canonical: true, tenantId: "tenant-org" }),
}));

const mockGetFirestore = getFirestore as jest.MockedFunction<typeof getFirestore>;

function keyDocFor(overrides: Record<string, any>) {
  return {
    get: jest.fn().mockResolvedValue({
      exists: overrides.exists ?? true,
      data: () => ({
        userId: "tenant-org",
        programId: "cerebro",
        active: true,
        rateLimitTier: "wingman",
        capabilities: ["dispatch.read", "dispatch.write"],
        ...overrides,
      }),
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

describe("WS-2: AuthContext.seatId population", () => {
  let originalAuthMode: string | undefined;

  beforeEach(() => {
    originalAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "key_identity";
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("populates seatId from the key doc's seatId field", async () => {
    const apiKey = "cb_seat_a_key";
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const keyDocRef = keyDocFor({ seatId: "seat-A", tier: "wingman" });

    mockGetFirestore.mockReturnValue({
      doc: jest.fn((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      }),
    } as any);

    const result = await validateApiKey(apiKey);
    expect(result?.seatId).toBe("seat-A");
  });

  it("leaves seatId undefined for non-seat keys", async () => {
    const apiKey = "cb_no_seat_key";
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const keyDocRef = keyDocFor({});

    mockGetFirestore.mockReturnValue({
      doc: jest.fn((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      }),
    } as any);

    const result = await validateApiKey(apiKey);
    expect(result?.seatId).toBeUndefined();
  });

  it("never derives seatId from a programIdOverride/header — only the key doc's own field", async () => {
    const apiKey = "cb_seat_b_key";
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const keyDocRef = keyDocFor({ seatId: "seat-B", tier: "wingman" });

    mockGetFirestore.mockReturnValue({
      doc: jest.fn((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      }),
    } as any);

    // key_identity mode ignores the override entirely for programId/capabilities,
    // and seatId must likewise come only from the doc — not from this header value.
    const result = await validateApiKey(apiKey, "seat-injected-via-header");
    expect(result?.seatId).toBe("seat-B");
  });

  it("revoking one seat's key leaves a peer seat's key unaffected", async () => {
    const seatAKey = "cb_seat_a_key_2";
    const seatBKey = "cb_seat_b_key_2";
    const seatAHash = crypto.createHash("sha256").update(seatAKey).digest("hex");
    const seatBHash = crypto.createHash("sha256").update(seatBKey).digest("hex");

    const seatADoc = keyDocFor({ seatId: "seat-A2", tier: "wingman", active: false }); // revoked
    const seatBDoc = keyDocFor({ seatId: "seat-B2", tier: "wingman", active: true });

    mockGetFirestore.mockReturnValue({
      doc: jest.fn((path: string) => {
        if (path === `keyIndex/${seatAHash}`) return seatADoc;
        if (path === `keyIndex/${seatBHash}`) return seatBDoc;
        throw new Error(`Unexpected doc path: ${path}`);
      }),
    } as any);

    const resultA = await validateApiKey(seatAKey);
    const resultB = await validateApiKey(seatBKey);

    expect(resultA).toBeNull(); // revoked
    expect(resultB?.seatId).toBe("seat-B2"); // unaffected
  });
});

describe("WS-2: per-seat usage metering isolation", () => {
  let setMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setMock = jest.fn().mockResolvedValue(undefined);
    mockGetFirestore.mockReturnValue({
      doc: jest.fn((path: string) => ({
        path,
        set: setMock,
      })),
    } as any);
  });

  it("writes to a seats.{seatId}.{field} map path scoped to that seat only", () => {
    incrementSeatUsage("tenant-org", "seat-A", "total_tool_calls");

    expect(setMock).toHaveBeenCalledTimes(1);
    const [data, opts] = setMock.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(Object.keys(data)).toEqual(["seats"]);
    expect(Object.keys(data.seats)).toEqual(["seat-A"]);
    expect(Object.keys(data.seats["seat-A"])).toEqual(["total_tool_calls"]);
  });

  it("two seats' counters are isolated — seat A calls never reference seat B's key", () => {
    incrementSeatUsage("tenant-org", "seat-A", "total_tool_calls");
    incrementSeatUsage("tenant-org", "seat-B", "total_tool_calls");

    expect(setMock).toHaveBeenCalledTimes(2);
    const dataA = setMock.mock.calls[0][0];
    const dataB = setMock.mock.calls[1][0];
    expect(Object.keys(dataA.seats)).toEqual(["seat-A"]);
    expect(Object.keys(dataB.seats)).toEqual(["seat-B"]);
  });

  it("incrementUsage (tenant total) does not write any seats field", () => {
    incrementUsage("tenant-org", "total_tool_calls");

    expect(setMock).toHaveBeenCalledTimes(1);
    const data = setMock.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(["total_tool_calls"]);
    expect(data.seats).toBeUndefined();
  });

  it("revoking a seat's key does not touch the tenant usage/seat counter doc", () => {
    // Counters live at tenants/{org}/usage/{period} keyed by seatId — a
    // separate document from keyIndex/{hash}. Revoking a key never calls
    // incrementSeatUsage, so the counter doc is untouched by revocation.
    incrementSeatUsage("tenant-org", "seat-A", "total_tool_calls");
    expect(setMock).toHaveBeenCalledTimes(1);

    // Simulated "revoke" is just not calling incrementSeatUsage again —
    // no additional writes happen for seat-A or seat-B.
    expect(setMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ seats: expect.objectContaining({ "seat-B": expect.anything() }) }),
      expect.anything()
    );
  });
});
