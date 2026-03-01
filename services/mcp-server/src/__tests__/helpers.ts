import { AuthContext } from "../auth/authValidator";

export function mockAuth(overrides?: Partial<AuthContext>): AuthContext {
  return {
    userId: "test-user-123",
    programId: "orchestrator",
    apiKeyHash: "test-hash",
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    capabilities: ["*"],
    rateLimitTier: "internal",
    ...overrides,
  };
}
