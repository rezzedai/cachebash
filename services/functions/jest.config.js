module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { tsconfig: { allowJs: true, esModuleInterop: true, module: "commonjs", moduleResolution: "node", target: "ES2022", skipLibCheck: true } }],
  },
  transformIgnorePatterns: ["node_modules/(?!jose/)"],
  testMatch: ["<rootDir>/src/**/*.test.ts"],
};
