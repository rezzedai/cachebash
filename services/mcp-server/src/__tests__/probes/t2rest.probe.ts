import { world } from "./harness/load";
import { rest } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { nextN, seederCall } from "./harness/cases";
import { marker } from "./harness/data";
import { probe } from "./harness/registry";

/**
 * T2, REST routes that read or write Firestore without going through a tool handler
 * (recon rows 52 and 53). Same pairing: the subject's own call must reach seeded data.
 */
describe("T2 REST routes", () => {
  const unread = async (subject: "alpha" | "beta") => {
    const w = world();
    const r = await rest(w, w.creds.scoped, "GET", `/v1/messages/unread?sessionId=${subject}`);
    return r.httpStatus === 200 && r.text.includes(marker("A", subject));
  };
  probe("T2.rest_messages_unread", async () => {
    expect(await unread("beta")).toBe(false);
  });
  test("T2.rest_messages_unread control: own subject reaches seeded data", async () => {
    expect(await unread("alpha")).toBe(true);
  });

  const markRead = async (subject: "alpha" | "beta") => {
    const w = world();
    const n = nextN();
    const sent = await seederCall({ w, subject, n }, "relay_send_message", { message: `mr-${n}`, source: "legacy", target: subject, message_type: "DIRECTIVE" });
    const id = sent.json.messageId as string;
    await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [id] });
    return (await emulatorDb().doc(`tenants/${w.tenants.A}/relay/${id}`).get()).data()?.status === "read";
  };
  probe("T2.rest_messages_mark_read", async () => {
    expect(await markRead("beta")).toBe(false);
  });
  test("T2.rest_messages_mark_read control: own message is marked read", async () => {
    expect(await markRead("alpha")).toBe(true);
  });
});
