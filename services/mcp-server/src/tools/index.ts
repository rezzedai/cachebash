/**
 * Tool Registry — Merges all domain registries into unified TOOL_HANDLERS and TOOL_DEFINITIONS.
 * 69 handlers across 18 domain registries.
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

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const TOOL_HANDLERS: Record<string, Handler> = {
  ...dispatch.handlers,
  ...relay.handlers,
  ...pulse.handlers,
  ...signal.handlers,
  ...dream.handlers,
  ...sprint.handlers,
  ...keys.handlers,
  ...programs.handlers,
  ...audit.handlers,
  ...programState.handlers,
  ...metrics.handlers,
  ...usage.handlers,
  ...trace.handlers,
  ...feedback.handlers,
  ...clu.handlers,
  ...admin.handlers,
  ...gsp.handlers,
  ...patternConsolidation.handlers,
  ...schedule.handlers,
};

export const TOOL_DEFINITIONS = [
  ...dispatch.definitions,
  ...relay.definitions,
  ...pulse.definitions,
  ...signal.definitions,
  ...dream.definitions,
  ...sprint.definitions,
  ...keys.definitions,
  ...programs.definitions,
  ...audit.definitions,
  ...programState.definitions,
  ...metrics.definitions,
  ...usage.definitions,
  ...trace.definitions,
  ...feedback.definitions,
  ...clu.definitions,
  ...admin.definitions,
  ...gsp.definitions,
  ...patternConsolidation.definitions,
  ...schedule.definitions,
];
