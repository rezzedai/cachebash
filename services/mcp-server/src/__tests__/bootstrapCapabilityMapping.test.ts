/**
 * RD-5 PR-G (C-3): verifies the recon's inference that gsp_bootstrap maps to
 * gsp.write. If it holds, the tenant `paused` kill switch denies gsp_bootstrap,
 * which is why dispatchPaused must be a separate, narrower flag.
 */
import { TOOL_CAPABILITIES } from "../middleware/capabilities";
import { isMutatingTool } from "../middleware/circuitBreaker";

jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn(), serverTimestamp: jest.fn() }));
jest.mock("../modules/signal.js", () => ({ sendAlertHandler: jest.fn() }));

describe("gsp_bootstrap capability mapping (RD-5 C-3 inference)", () => {
  it("maps gsp_bootstrap to gsp.write", () => {
    expect(TOOL_CAPABILITIES["gsp_bootstrap"]).toBe("gsp.write");
  });

  it("classifies gsp_bootstrap as mutating, so the tenant paused switch denies it", () => {
    expect(isMutatingTool("gsp_bootstrap")).toBe(true);
  });
});
