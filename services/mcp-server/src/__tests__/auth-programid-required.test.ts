/**
 * RD-5 PR-H: identity comes only from the credential.
 *  - A keyIndex document with no programId is denied (it used to mint the "legacy" principal).
 *  - validateApiKey and validateAuth take one argument; a second argument is a compile error.
 *  - credentialPrincipal throws when keyProgramId is empty.
 */
import * as crypto from "crypto";
import { validateApiKey, validateAuth } from "../auth/authValidator";
import type { AuthContext } from "../auth/authValidator";
import { credentialPrincipal } from "../auth/ownerAuthz";
import { getFirestore } from "../firebase/client";

jest.mock("../firebase/client");
jest.mock("../middleware/capabilities", () => ({
  getDefaultCapabilities: jest.fn().mockReturnValue(["dispatch.read"]),
}));
jest.mock("../auth/tenant-resolver", () => ({
  resolveTenant: jest.fn().mockResolvedValue({ canonical: true, tenantId: "tenant-org" }),
}));

const mockGetFirestore = getFirestore as jest.MockedFunction<typeof getFirestore>;

function mockKeyDoc(apiKey: string, data: Record<string, unknown>) {
  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const ref = {
    get: jest.fn().mockResolvedValue({ exists: true, data: () => data }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  mockGetFirestore.mockReturnValue({
    doc: jest.fn((path: string) => {
      if (path === `keyIndex/${keyHash}`) return ref;
      throw new Error(`Unexpected doc path: ${path}`);
    }),
  } as any);
}

describe("keyIndex document programId is required", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("control: a key document with a programId authenticates, principal is that programId", async () => {
    mockKeyDoc("cb_has_program", { userId: "tenant-org", programId: "basher", active: true });
    const auth = await validateApiKey("cb_has_program");
    expect(auth?.programId).toBe("basher");
    expect(auth?.keyProgramId).toBe("basher");
  });

  it.each([
    ["absent", {}],
    ["empty string", { programId: "" }],
    ["null", { programId: null }],
    ["not a string", { programId: 7 }],
  ])("a key document whose programId is %s fails auth, and no legacy principal is minted", async (_label, extra) => {
    mockKeyDoc("cb_no_program", { userId: "tenant-org", active: true, capabilities: ["*"], ...extra });
    expect(await validateApiKey("cb_no_program")).toBeNull();
    expect(await validateAuth("cb_no_program")).toBeNull();
  });
});

describe("credentialPrincipal has no fallback", () => {
  const base = { userId: "u", apiKeyHash: "h", encryptionKey: Buffer.alloc(0), capabilities: [], rateLimitTier: "free" };

  it("returns keyProgramId", () => {
    const auth = { ...base, programId: "iso", keyProgramId: "radia" } as unknown as AuthContext;
    expect(credentialPrincipal(auth)).toBe("radia");
  });

  it("throws when keyProgramId is empty, even though programId is set", () => {
    const auth = { ...base, programId: "iso", keyProgramId: "" } as unknown as AuthContext;
    expect(() => credentialPrincipal(auth)).toThrow(/keyProgramId/);
  });

  it("throws when keyProgramId is missing", () => {
    const auth = { ...base, programId: "iso" } as unknown as AuthContext;
    expect(() => credentialPrincipal(auth)).toThrow(/keyProgramId/);
  });
});

describe("single-argument signatures", () => {
  it("validateApiKey and validateAuth declare exactly one parameter (a second argument is a compile error)", () => {
    type ApiKeyArity = Parameters<typeof validateApiKey>["length"];
    type AuthArity = Parameters<typeof validateAuth>["length"];
    const apiKeyArity: ApiKeyArity = 1;
    const authArity: AuthArity = 1;
    // @ts-expect-error arity 2 is not assignable while the signature has one parameter
    const apiKeyTwo: ApiKeyArity = 2;
    // @ts-expect-error arity 2 is not assignable while the signature has one parameter
    const authTwo: AuthArity = 2;
    expect([apiKeyArity, authArity, apiKeyTwo, authTwo]).toEqual([1, 1, 2, 2]);
    expect(validateApiKey.length).toBe(1);
    expect(validateAuth.length).toBe(1);
  });
});
