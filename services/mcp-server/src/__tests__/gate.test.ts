/**
 * gate.ts — verifySource unit tests (F-360-1)
 *
 * These tests exercise the REAL verifySource function — no mocks.
 * Purpose: regression guard against any future change that re-opens the
 * BUG-005 impersonation path (hybrid-mode X-Program-Id override bypass).
 *
 * BUG-005 attack vector:
 *   cb_ key bound to "basher" + X-Program-Id: iso → auth.programId = "iso"
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
  describe("BUG-005 attack: keyProgramId !== programId (X-Program-Id override)", () => {
    it("rejects claimed source matching programId override but not keyProgramId", () => {
      // Exact BUG-005 scenario:
      //   cb_basher_key sets X-Program-Id: iso → auth.programId = "iso"
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
      // Same auth context (X-Program-Id override active) but caller claims own identity.
      const auth = makeAuth({
        keyProgramId: "basher" as ValidProgramId,
        programId: "iso" as ValidProgramId,
      });

      expect(verifySource("basher", auth, "mcp")).toBe("basher");
    });
  });

  describe("normal operation (no X-Program-Id override)", () => {
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

  describe("legacy/mobile exemption (admin-tier actors)", () => {
    it("allows legacy key to claim any source", () => {
      const auth = makeAuth({ keyProgramId: "legacy" as ValidProgramId, programId: "legacy" as ValidProgramId });
      expect(verifySource("iso", auth, "mcp")).toBe("iso");
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

  describe("backward compat — keyProgramId absent (test mocks / legacy callers)", () => {
    it("falls back to programId when keyProgramId is absent", () => {
      // Simulates pre-BUG-005 mocks that never set keyProgramId.
      const auth = makeAuth({ keyProgramId: undefined, programId: "vector" as ValidProgramId });
      expect(verifySource("vector", auth, "mcp")).toBe("vector");
    });

    it("throws when programId fallback mismatches claimed source", () => {
      const auth = makeAuth({ keyProgramId: undefined, programId: "vector" as ValidProgramId });
      expect(() => verifySource("iso", auth, "mcp")).toThrow(/Source mismatch/);
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
