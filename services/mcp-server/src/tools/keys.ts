/**
 * Keys Domain Registry — API key management tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { createKeyHandler, revokeKeyHandler, rotateKeyHandler, listKeysHandler } from "../modules/keys.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  create_key: createKeyHandler,
  revoke_key: revokeKeyHandler,
  rotate_key: rotateKeyHandler,
  list_keys: listKeysHandler,
};

export const definitions = [
  {
    name: "create_key",
    description: "Create a new per-program API key. Returns the raw key (only shown once).",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program this key authenticates as", maxLength: 50 },
        label: { type: "string", description: "Human-readable label for key management", maxLength: 200 },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description: 'Optional capability scopes. Defaults to program defaults or ["*"] if unknown.',
        },
      },
      required: ["programId", "label"],
    },
  },
  {
    name: "revoke_key",
    description: "Revoke an API key by its hash. Soft revoke — key stays in DB for audit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keyHash: { type: "string", description: "SHA-256 hash of the key to revoke" },
      },
      required: ["keyHash"],
    },
  },
  {
    name: "rotate_key",
    description: "Rotate the calling API key. Atomically creates a new key and grace-expires the old one (30s window).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_keys",
    description: "List all API keys for the authenticated user. Returns metadata, never raw keys.",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeRevoked: { type: "boolean", default: false, description: "Include revoked keys in results" },
      },
    },
  },
];
