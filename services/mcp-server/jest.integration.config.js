module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { tsconfig: { allowJs: true, esModuleInterop: true, module: "commonjs", moduleResolution: "node", target: "ES2022", skipLibCheck: true } }],
  },
  transformIgnorePatterns: ["node_modules/(?!(@octokit|jose)/)"],
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 1, // Serial execution — tests share Firestore emulator state
};
