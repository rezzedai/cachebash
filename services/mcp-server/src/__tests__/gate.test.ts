/**
 * gate.ts — verifySource unit tests (F-360-1)
 *
 * These tests exercise the REAL verifySource function — no mocks.
 * Purpose: regression guard against any future change that re-opens the
 * BUG-005 impersonation path (auth.programId differing from the key's program).
 *
 * BUG-005 attack vector:
 *   cb_ key bound to "basher" with auth.programId = "iso"
 *   caller passes source: "iso" → old code: "iso" === auth.programId → passes
 *   new code: "iso" !== auth.keyProgramId ("basher") → rejected
 */

import type { AuthContext } from "../auth/authValidator";
import { verifySource } from "../middleware/gate";
import type { ValidProgramId } from "../config/programs";

// Minimal stub — no Firestore, no network.
function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "test-user",
    apiKeyHash: "hash",
    encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
    programId: "basher" as ValidProgramId,
    keyProgramId: "basher" as ValidProgramId,
    capabilities: ["*"],
    rateLimitTier: "internal",
    ...overrides,
  };
}

jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(),
  serverTimestamp: jest.fn(),
}));

jest.mock("../modules/events", () => ({
  emitEvent: jest.fn(),
}));

describe("verifySource — BUG-005 regression (F-360-1)", () => {
  describe("BUG-005 attack: keyProgramId !== programId", () => {
    it("rejects claimed source matching programId but not keyProgramId", () => {
      // Exact BUG-005 scenario:
      //   cb_basher_key with auth.programId = "iso"
      //   caller passes source: "iso"
      //   MUST throw — keyProgramId "basher" does not own source "iso"
      const auth = makeAuth({
        keyProgramId: "basher" as ValidProgramId,
        programId: "iso" as ValidProgramId,
      });

      expect(() => verifySource("iso", auth, "mcp")).toThrow(
        /Source mismatch.*basher.*iso/
      );
    });

    it("allows claimed source matching keyProgramId even when programId differs", () => {
      // Same auth context (programId differs) but caller claims own identity.
      const auth = makeAuth({
        keyProgramId: "basher" as ValidProgramId,
        programId: "iso" as ValidProgramId,
      });

      expect(verifySource("basher", auth, "mcp")).toBe("basher");
    });
  });

  describe("normal operation (programId equals keyProgramId)", () => {
    it("returns keyProgramId when source is undefined", () => {
      const auth = makeAuth({ keyProgramId: "basher" as ValidProgramId });
      expect(verifySource(undefined, auth, "mcp")).toBe("basher");
    });

    it("returns claimed source when it matches keyProgramId", () => {
      const auth = makeAuth({ keyProgramId: "basher" as ValidProgramId, programId: "basher" as ValidProgramId });
      expect(verifySource("basher", auth, "mcp")).toBe("basher");
    });

    it("throws when claimed source mismatches keyProgramId", () => {
      const auth = makeAuth({ keyProgramId: "sark" as ValidProgramId, programId: "sark" as ValidProgramId });
      expect(() => verifySource("basher", auth, "mcp")).toThrow(/Source mismatch/);
    });
  });

  describe("source exemption (RD-5 PR-K: mobile only)", () => {
    it("rejects a legacy key claiming another source, naming legacy", () => {
      const auth = makeAuth({ keyProgramId: "legacy" as ValidProgramId, programId: "legacy" as ValidProgramId });
      expect(() => verifySource("iso", auth, "mcp")).toThrow(/key belongs to "legacy", claimed "iso"/);
    });

    it("allows mobile key to claim any source", () => {
      const auth = makeAuth({ keyProgramId: "mobile" as ValidProgramId, programId: "mobile" as ValidProgramId });
      expect(verifySource("basher", auth, "mcp")).toBe("basher");
    });

    it("legacy with undefined source returns 'legacy'", () => {
      const auth = makeAuth({ keyProgramId: "legacy" as ValidProgramId, programId: "legacy" as ValidProgramId });
      expect(verifySource(undefined, auth, "mcp")).toBe("legacy");
    });
  });

  describe("keyProgramId absent", () => {
    it("throws: a missing credential identity never reads as a principal, and programId is not a fallback", () => {
      const auth = makeAuth({ keyProgramId: undefined, programId: "vector" as ValidProgramId });
      expect(() => verifySource("vector", auth, "mcp")).toThrow(/keyProgramId is empty/);
    });
  });

  describe("endpoint parameter is passed through to error message context", () => {
    it("throws on admin endpoint with same mismatch", () => {
      const auth = makeAuth({ keyProgramId: "basher" as ValidProgramId, programId: "basher" as ValidProgramId });
      expect(() => verifySource("iso", auth, "admin")).toThrow(/Source mismatch/);
    });

    it("throws on rest endpoint with same mismatch", () => {
      const auth = makeAuth({ keyProgramId: "basher" as ValidProgramId, programId: "basher" as ValidProgramId });
      expect(() => verifySource("iso", auth, "rest")).toThrow(/Source mismatch/);
    });
  });
});
