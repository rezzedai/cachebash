/**
 * gsp_bootstrap memory status — RD-5 PR-I. payload.memory.status is always present
 * with one of "loaded", "empty", "omitted", "error". A failed self-read sets
 * memory.error and context.loadError (appended to any existing loadError).
 */
import type { AuthContext } from "../auth/authValidator";
import { gspBootstrapHandler } from "../modules/gsp";

let mockDocs: Record<string, any> = {};
let failPaths: Set<string> = new Set();

function emptyQuery(colPath: string) {
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    async get() {
      if (failPaths.has(colPath)) throw new Error(`FAILED_PRECONDITION on ${colPath}`);
      return { docs: [], empty: true, size: 0 };
    },
  };
  return chain;
}

const mockDb = {
  doc: (path: string) => ({
    async get() {
      if (failPaths.has(path)) throw new Error(`UNAVAILABLE reading ${path}`);
      const data = mockDocs[path];
      return { exists: data !== undefined, id: path.split("/").pop(), data: () => data };
    },
  }),
  collection: (path: string) => emptyQuery(path),
};

jest.mock("../firebase/client", () => ({ getFirestore: jest.fn(() => mockDb) }));
jest.mock("../middleware/capabilities", () => ({ getDefaultCapabilities: jest.fn(() => ["*"]) }));
jest.mock("../modules/events", () => ({ emitEvent: jest.fn() }));

const USER_ID = "test-user-123";
const STATE_PATH = `tenants/${USER_ID}/sessions/_meta/program_state/iso`;

const authFor = (programId: string, capabilities: string[]): AuthContext => ({
  userId: USER_ID,
  apiKeyHash: "test-key-hash",
  keyProgramId: programId as any,
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities,
  rateLimitTier: "internal",
});

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

beforeEach(() => {
  jest.clearAllMocks();
  mockDocs = {};
  failPaths = new Set();
  mockDocs[`tenants/${USER_ID}/programs/iso`] = {
    programId: "iso", displayName: "ISO", role: "orchestrator", groups: [], tags: [], active: true,
  };
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("payload.memory.status", () => {
  it('"loaded": self-read, document found', async () => {
    mockDocs[STATE_PATH] = {
      learnedPatterns: [],
      contextSummary: { lastTask: null, activeWorkItems: [], handoffNotes: "h", openQuestions: [] },
    };
    const data = parse(await gspBootstrapHandler(authFor("iso", ["gsp.write"]), { agentId: "iso" }));
    expect(data.payload.memory.status).toBe("loaded");
    expect(data.payload.memory.error).toBeUndefined();
    expect(data.payload.context.loadError).toBeUndefined();
  });

  it('"empty": self-read, no document', async () => {
    const data = parse(await gspBootstrapHandler(authFor("iso", ["gsp.write"]), { agentId: "iso" }));
    expect(data.payload.memory.status).toBe("empty");
    expect(data.payload.memory.error).toBeUndefined();
    expect(data.payload.context.loadError).toBeUndefined();
  });

  it('"omitted": cross-program bootstrap', async () => {
    mockDocs[STATE_PATH] = { learnedPatterns: [], contextSummary: { handoffNotes: "secret" } };
    const data = parse(await gspBootstrapHandler(authFor("vector", ["fleet.observe"]), { agentId: "iso" }));
    expect(data.payload.memory.status).toBe("omitted");
    expect(data.payload.memory.omitted).toBe(true);
    expect(typeof data.payload.memory.omittedReason).toBe("string");
    expect(data.payload.context.loadError).toBeUndefined();
  });

  it('"error": the self-read throws; error and loadError carry the message, logged at error level', async () => {
    failPaths.add(STATE_PATH);
    const data = parse(await gspBootstrapHandler(authFor("iso", ["gsp.write"]), { agentId: "iso" }));
    expect(data.success).toBe(true);
    expect(data.payload.memory.status).toBe("error");
    expect(data.payload.memory.error).toContain("UNAVAILABLE reading");
    expect(data.payload.context.loadError).toBe(data.payload.memory.error);
    expect(console.error).toHaveBeenCalled();
  });

  it('"error": a corrupt document (learnedPatterns not an array) is an error, not an empty block', async () => {
    mockDocs[STATE_PATH] = { learnedPatterns: "not-an-array", contextSummary: { handoffNotes: "x" } };
    const data = parse(await gspBootstrapHandler(authFor("iso", ["gsp.write"]), { agentId: "iso" }));
    expect(data.payload.memory.status).toBe("error");
    expect(data.payload.context.loadError).toBe(data.payload.memory.error);
  });

  it("error text is kept when the pendingTasks read also fails (appended, not overwritten)", async () => {
    failPaths.add(STATE_PATH);
    failPaths.add(`tenants/${USER_ID}/tasks`);
    const data = parse(await gspBootstrapHandler(authFor("iso", ["gsp.write"]), { agentId: "iso" }));
    expect(data.payload.memory.status).toBe("error");
    expect(data.payload.context.loadError).toContain(data.payload.memory.error);
    expect(data.payload.context.loadError).toContain("pendingTasks:");
  });
});
