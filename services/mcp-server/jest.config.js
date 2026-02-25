module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/integration/"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
