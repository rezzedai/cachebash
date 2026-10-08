import { assertEmulatorOnly, ProductionRefusal } from "./harness/guard";

describe("harness refuses production (own test)", () => {
  const ok = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_PROJECT_ID: "demo-rd5" };

  test("accepts a local emulator with a demo- project", () => {
    expect(assertEmulatorOnly(ok)).toEqual({ emulatorHost: "127.0.0.1:8080", projectId: "demo-rd5" });
    expect(assertEmulatorOnly({ ...ok, FIRESTORE_EMULATOR_HOST: "localhost:9000" }).emulatorHost).toBe("localhost:9000");
    // what `firebase emulators:exec --project demo-rd5` actually exports
    expect(assertEmulatorOnly({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "demo-rd5" }).projectId).toBe("demo-rd5");
  });

  test.each([
    ["no emulator host", { FIREBASE_PROJECT_ID: "demo-rd5" }],
    ["empty emulator host", { FIRESTORE_EMULATOR_HOST: "  ", FIREBASE_PROJECT_ID: "demo-rd5" }],
    ["non-local host", { ...ok, FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }],
    ["lookalike host", { ...ok, FIRESTORE_EMULATOR_HOST: "localhost.evil.example:8080" }],
    ["private ip", { ...ok, FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }],
    ["host without port", { ...ok, FIRESTORE_EMULATOR_HOST: "localhost" }],
    ["production project id", { ...ok, FIREBASE_PROJECT_ID: "cachebash-app" }],
    ["production id in GCLOUD_PROJECT only", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "cachebash-app" }],
    ["demo id in one var, production id in the other", { ...ok, GCLOUD_PROJECT: "cachebash-app" }],
    ["no project id at all", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
    ["demo substring but not prefix", { ...ok, FIREBASE_PROJECT_ID: "my-demo-rd5" }],
  ])("refuses: %s", (_name, env) => {
    expect(() => assertEmulatorOnly(env as NodeJS.ProcessEnv)).toThrow(ProductionRefusal);
  });
});
