import { world } from "./harness/load";
import { callTool, listTools } from "./harness/client";

describe("harness smoke: the built server answers from the emulator", () => {
  test("health", async () => {
    const r = await fetch(`${world().baseUrl}/health`);
    expect(r.status).toBe(200);
  });
  test("wildcard sees tools; keys_list_keys returns seeded keys", async () => {
    const w = world();
    const tools = await listTools(w, w.creds.wildcard);
    expect(tools.length).toBeGreaterThan(50);
    const r = await callTool(w, w.creds.wildcard, "keys_list_keys", {});
    console.log(JSON.stringify(r).slice(0, 600));
    expect(r.json?.success).toBe(true);
  });
});
