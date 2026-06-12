/**
 * Tool Registry — Merges all domain registries into unified TOOL_HANDLERS and TOOL_DEFINITIONS.
 * 73 handlers across 21 domain registries.
 *
 * Deploy profiles (CACHEBASH_PROFILE env var):
 *   "full" (default) — all modules; Grid prod (cachebash-app)
 *   "lite"           — core modules only; tenant deployments (cerebro-grid, future tenants)
 *                      Excludes: dream, schedule, clu, patternConsolidation, usage
 *                      Spec: cerebro/cachebash-lite.profile.js in rezzedai/grid
 */
import { AuthContext } from "../auth/authValidator.js";

import * as dispatch from "./dispatch.js";
import * as relay from "./relay.js";
import * as pulse from "./pulse.js";
import * as signal from "./signal.js";
import * as dream from "./dream.js";
import * as sprint from "./sprint.js";
import * as keys from "./keys.js";
import * as programs from "./programs.js";
import * as audit from "./audit.js";
import * as programState from "./programState.js";
import * as metrics from "./metrics.js";
import * as usage from "./usage.js";
import * as trace from "./trace.js";
import * as feedback from "./feedback.js";
import * as clu from "./clu.js";
import * as admin from "./admin.js";
import * as gsp from "./gsp.js";
import * as patternConsolidation from "./patternConsolidation.js";
import * as schedule from "./schedule.js";
import * as policy from "./policy.js";
import * as webhook from "./webhook.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

const IS_LITE = (process.env.CACHEBASH_PROFILE ?? "full") === "lite";

export const TOOL_HANDLERS: Record<string, Handler> = {
  ...dispatch.handlers,
  ...relay.handlers,
  ...pulse.handlers,
  ...signal.handlers,
  ...sprint.handlers,
  ...keys.handlers,
  ...programs.handlers,
  ...audit.handlers,
  ...programState.handlers,
  ...metrics.handlers,
  ...trace.handlers,
  ...feedback.handlers,
  ...admin.handlers,
  ...gsp.handlers,
  ...policy.handlers,
  ...webhook.handlers,
  // enrichment/analytics tier — omitted in lite profile
  ...(!IS_LITE ? dream.handlers : {}),
  ...(!IS_LITE ? usage.handlers : {}),
  ...(!IS_LITE ? clu.handlers : {}),
  ...(!IS_LITE ? patternConsolidation.handlers : {}),
  ...(!IS_LITE ? schedule.handlers : {}),
};

export const TOOL_DEFINITIONS = [
  ...dispatch.definitions,
  ...relay.definitions,
  ...pulse.definitions,
  ...signal.definitions,
  ...sprint.definitions,
  ...keys.definitions,
  ...programs.definitions,
  ...audit.definitions,
  ...programState.definitions,
  ...metrics.definitions,
  ...trace.definitions,
  ...feedback.definitions,
  ...admin.definitions,
  ...gsp.definitions,
  ...policy.definitions,
  ...webhook.definitions,
  // enrichment/analytics tier — omitted in lite profile
  ...(!IS_LITE ? dream.definitions : []),
  ...(!IS_LITE ? usage.definitions : []),
  ...(!IS_LITE ? clu.definitions : []),
  ...(!IS_LITE ? patternConsolidation.definitions : []),
  ...(!IS_LITE ? schedule.definitions : []),
];
