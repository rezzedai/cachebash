import { TOOL_CAPABILITIES } from "../middleware/capabilities";

/**
 * Test fixture (RD-5 PR-N): a credential that names every capability a tool maps to. This is what the wildcard granted at
 * the per-tool gate before PR-N, as an explicit list. Not a testMatch file (no .test.ts suffix).
 */
export const ALL_MAPPED_CAPABILITIES: string[] = [...new Set(Object.values(TOOL_CAPABILITIES))].sort();
