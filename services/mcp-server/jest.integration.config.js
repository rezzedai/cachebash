module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 1, // Serial execution — tests share Firestore emulator state
};
