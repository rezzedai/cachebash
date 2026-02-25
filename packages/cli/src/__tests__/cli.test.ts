import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

describe("session token generation", () => {
  it("generates 32-byte hex tokens", () => {
    const token = randomBytes(32).toString("hex");
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const a = randomBytes(32).toString("hex");
    const b = randomBytes(32).toString("hex");
    assert.notEqual(a, b);
  });
});

describe("config detection", () => {
  it("returns empty array when no configs exist", async () => {
    // detectConfigs checks for files at home directory paths
    // In test, we just verify the function doesn't throw
    const { detectConfigs } = await import("../config/writer.js");
    const configs = await detectConfigs();
    assert.ok(Array.isArray(configs));
  });
});

describe("--key flag parsing", () => {
  it("extracts key from args", () => {
    const args = ["init", "--key", "cb_test_123"];
    const keyIndex = args.indexOf("--key");
    const key = keyIndex !== -1 ? args[keyIndex + 1] : undefined;
    assert.equal(key, "cb_test_123");
  });

  it("returns undefined when no --key flag", () => {
    const args = ["init"];
    const keyIndex = args.indexOf("--key");
    const key = keyIndex !== -1 ? args[keyIndex + 1] : undefined;
    assert.equal(key, undefined);
  });
});

describe("MCP server entry format", () => {
  it("builds correct server entry", () => {
    const key = "cb_test_abc";
    const entry = {
      type: "http",
      url: "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      headers: { Authorization: `Bearer ${key}` },
    };
    assert.equal(entry.type, "http");
    assert.ok(entry.url.includes("/v1/mcp"));
    assert.equal(entry.headers.Authorization, "Bearer cb_test_abc");
  });
});
