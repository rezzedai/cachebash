import { AuthContext } from "../auth/apiKeyValidator";

export function mockAuth(overrides?: Partial<AuthContext>): AuthContext {
  return {
    userId: "test-user-123",
    programId: "iso",
    apiKeyHash: "test-hash",
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    ...overrides,
  };
}
