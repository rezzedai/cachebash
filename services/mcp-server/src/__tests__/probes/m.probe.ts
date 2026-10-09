import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { probe } from "./harness/registry";

/** M (R5): a self-read whose state document cannot be read must say so, not return an empty memory block. */
describe("M bootstrap self-read failure", () => {
  probe("M.unreadable_state_is_an_error", async () => {
    const w = world();
    const mkProgram = async (name: string, corrupt: boolean) => {
      const caps = w.creds.scoped.capabilities;
      const k = await writeKey(w.tenants.A, name, `probe-m-${name}`, caps);
      await emulatorDb().doc(`tenants/${w.tenants.A}/sessions/_meta/program_state/${name}`).set(
        corrupt
          ? { programId: name, learnedPatterns: "not-an-array", contextSummary: { handoffNotes: "m-hidden" } }
          : { programId: name, learnedPatterns: [], contextSummary: { handoffNotes: "m-readable", lastTask: null, activeWorkItems: [], openQuestions: [] } }
      );
      return { ...w.creds.scoped, programId: name, key: k.key, keyHash: k.keyHash };
    };
    // control: a readable document comes back as memory
    const good = await callTool(w, await mkProgram("m-good", false), "gsp_bootstrap", { agentId: "m-good" });
    expect(good.json?.success).toBe(true);
    expect(good.text).toContain("m-readable");
    // deny: an unreadable one is reported as an error
    const bad = await callTool(w, await mkProgram("m-bad", true), "gsp_bootstrap", { agentId: "m-bad" });
    expect(bad.json?.success).toBe(true);
    expect(bad.json?.payload?.memory?.status).toBe("error");
  });
});
