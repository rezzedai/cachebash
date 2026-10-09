// Authorization probe corpus (RD-5 PR-B). Runs ONLY against the Firestore emulator,
// via `firebase emulators:exec` (see .github/workflows/ci.yml, job `Probes`).
// Probe files are *.probe.ts so the unit-test config (jest.config.js, *.test.ts) never picks them up.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src/__tests__/probes"],
  testMatch: ["**/*.probe.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: ["node_modules/(?!@octokit/.*)"],
  globalSetup: "<rootDir>/src/__tests__/probes/harness/globalSetup.ts",
  globalTeardown: "<rootDir>/src/__tests__/probes/harness/globalTeardown.ts",
  testTimeout: 60000,
  testSequencer: "<rootDir>/src/__tests__/probes/harness/sequencer.js",
  maxWorkers: 1, // one server, one emulator, serial: the transport keeps per-request auth on a shared field
};
