import * as crypto from "crypto";

// WP-1 rule (#433): a task doc for a non-user target must carry requires_action explicitly, because
// get_tasks filters on requires_action == true (WP-2) and Firestore drops docs missing the field.
// This drives the real handler and inspects the doc it actually writes to the tasks collection.

const SECRET = "test-secret";
const added: Array<{ path: string; doc: Record<string, unknown> }> = [];

jest.mock("firebase-functions/params", () => ({
  defineSecret: () => ({ value: () => "test-secret" }),
}));

jest.mock("firebase-admin", () => {
  const db = {
    collection: (path: string) => ({
      limit: () => ({ get: async () => ({ empty: false, docs: [{ id: "tenant1" }] }) }),
      add: async (doc: Record<string, unknown>) => {
        added.push({ path, doc });
        return { id: "new" };
      },
    }),
  };
  const firestore = Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => "SERVER_TS" },
    Timestamp: { fromMillis: (n: number) => ({ millis: n }) },
  });
  return { firestore };
});

import { onEasBuild } from "./onEasBuild";

function fakeRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

async function post(body: Record<string, unknown>) {
  const sig = "sha1=" + crypto.createHmac("sha1", SECRET).update(JSON.stringify(body)).digest("hex");
  const res = fakeRes();
  await (onEasBuild as any)({ method: "POST", headers: { "expo-signature": sig }, body }, res);
  return res;
}

beforeEach(() => { added.length = 0; });

describe("onEasBuild task write", () => {
  it("writes the build-failure task for iso with requires_action === true", async () => {
    const res = await post({
      status: "errored",
      platform: "ios",
      buildDetailsPageUrl: "https://expo.dev/builds/1",
      metadata: { appBuildVersion: "42", appVersion: "1.2.3", gitCommitHash: "abcdef123" },
      error: { message: "Pod install failed" },
    });
    expect(res.statusCode).toBe(200);
    const tasks = added.filter((a) => a.path === "tenants/tenant1/tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].doc.target).toBe("iso");
    expect(tasks[0].doc.requires_action).toBe(true);
  });

  it("writes no task when the build finished", async () => {
    await post({ status: "finished", platform: "ios", buildDetailsPageUrl: "u" });
    expect(added.filter((a) => a.path === "tenants/tenant1/tasks")).toHaveLength(0);
  });
});
