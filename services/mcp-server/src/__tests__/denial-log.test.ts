import { logDenial, denialPrincipal, DenialCode } from "../auth/denialLog.js";

describe("logDenial", () => {
  const codes: DenialCode[] = ["FOREIGN_SUBJECT", "NOT_OWNER", "NOT_GRANTED", "SOURCE_MISMATCH", "MISSING_CAPABILITY"];
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  test.each(codes)("writes one line with the 6 keys for %s", (code) => {
    logDenial({ principal: "alpha", tool: "state_get_program_state", subject: "beta", code });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warn.mock.calls[0][0]);
    expect(Object.keys(line).sort()).toEqual(["code", "event", "principal", "severity", "subject", "tool"]);
    expect(line).toEqual({ severity: "WARNING", event: "authz_denial", principal: "alpha", tool: "state_get_program_state", subject: "beta", code });
  });

  test("keeps subject: null", () => {
    logDenial({ principal: "alpha", tool: "keys_create_key", subject: null, code: "MISSING_CAPABILITY" });
    expect(JSON.parse(warn.mock.calls[0][0]).subject).toBeNull();
  });

  test("denialPrincipal never throws on an empty identity", () => {
    expect(denialPrincipal({ keyProgramId: "" as any })).toBe("(none)");
    expect(denialPrincipal({ keyProgramId: "alpha" as any })).toBe("alpha");
  });
});
