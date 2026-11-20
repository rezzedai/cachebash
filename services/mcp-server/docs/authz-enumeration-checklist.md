# Authorization call-site enumeration (RD-5 PR-C)

GENERATED from `docs/authz-sites.json` by `scripts/gen-authz-checklist.ts`. Do not edit by hand.
A test regenerates this file and fails on any difference. Edit the JSON, then run
`npx tsx scripts/gen-authz-checklist.ts` from `services/mcp-server`.

Base: `ca8600cc52cd5150a3106bec850d19789df3b601` (build: pin production Node 22 for cachebash-mcp (#500)) on rezzedai/cachebash. No handler is changed by this document.

## Result

**110 handlers enumerated. 0 serve ADR-015 bundles. 10 store caller-keyed tenant data, each partitioned by tenants/{auth.userId} at gsp_read at modules/gsp.ts:165; gsp_write at modules/gsp.ts:437; gsp_diff at modules/gsp.ts:499; gsp_bootstrap at modules/gsp.ts:760; gsp_seed at modules/gsp.ts:1228; gsp_propose at modules/gsp.ts:1339, modules/gsp.ts:1377; gsp_subscribe at modules/gsp.ts:231, modules/gsp.ts:261; gsp_resolve at modules/gsp.ts:1617, modules/gsp.ts:1693; gsp_search at modules/gsp.ts:1820; state_update_program_state at modules/programState.ts:583.**

N is the count of TOOL_HANDLERS keys in the default (full) profile: 110. TOOL_DEFINITIONS has 107; the three usage_* handlers (usage_get_usage, usage_get_invoice, usage_set_budget) have handlers and no definition. request_help is lite-profile only and is enumerated as a 111th entry with profile "lite"; it is not in the 110.

114 site records, 111 handler entries, 44 AST baseline rows.

| Disposition | Records |
|---|---|
| SELF-ONLY | 9 |
| FOREIGN-READ | 2 |
| FOREIGN-WRITE | 1 |
| ADDRESSED | 5 |
| ATTRIBUTION | 9 |
| NOT-IDENTITY | 5 |
| ESCALATE | 83 |
| **Total** | **114** |

Status: pending 84, done 30.

## Method

git grep -P, never -E: git 2.54 ignores \b under -E and returns 0 (amendment 2, item 1). Run from the repository root at the base sha.

Regex (a):

```
git grep -n -o -P '\b(args|query|body|req\.(params|query|body))\.(agentId|target|targetProgram|sessionId|programId|source)\b' -- services/mcp-server/src ':!services/mcp-server/src/__tests__'
```

Regex (b):

```
git grep -n -P '\b(args|query|body|p|params|input|parsed|validated)\.(agent|agentId|program|programId|program_id|target|targetProgram|target_program|sessionId|session_id|source|callerSource|from|to|recipient|owner|ownerId|assignee|claimedBy|seatId|tenantId|userId|uid|principal|newTarget|reassignTo|escalateTo|keyHash)\b' -- services/mcp-server/src ':!services/mcp-server/src/__tests__'
```

Regex (c):

```
git grep -n -P 'const \{[^}]*\b(agentId|target|targetProgram|sessionId|programId|source|keyHash|userId|callerSource)\b[^}]*\} = (args|req|body|query|input|parsed|params|p)\b' -- services/mcp-server/src ':!services/mcp-server/src/__tests__'
```

| Measure | Count at base |
|---|---|
| (a) occurrences | 295 |
| (a) lines | 278 |
| (a) files | 18 |
| (b) lines beyond (a) | 59 (new since the recon: modules/signal.ts:213, modules/signal.ts:219, modules/signal.ts:240) |
| (c) lines | 3 |

Expected at the base: 271 occurrences, 255 lines, 18 files; 59; 3. Differs from expected: no.

Sites are keyed by handler and expression, not by line. `line_at_base` is the first line at the base sha.

### Disposition vocabulary (D-e)

| Label | Meaning |
|---|---|
| SELF-ONLY | the caller may act only on its own subject |
| FOREIGN-READ | a foreign subject may be read, widened only by literal fleet.observe |
| FOREIGN-WRITE | a foreign subject may be written, widened only by literal fleet.admin |
| ADDRESSED | the argument names a recipient; the sender is bound by the resolver |
| ATTRIBUTION | the argument is stored as a label and selects nothing |
| NOT-IDENTITY | regex hit that is not a caller argument, with the reason |
| ESCALATE | disposition not readable from the code; evidence and a recommendation given, ISO and VECTOR decide |

## ESCALATE (83)

Each record gives the evidence and a recommendation. The builder picks nothing; ISO reviews every record and VECTOR reviews ESCALATE, ADDRESSED and ATTRIBUTION.

### `index.main:params.target`

- Where: `index.ts`, handler `main`, expression `params.target`, line 631 at base, 2 occurrence(s).
- Tool: none; transports internal; effect write; decided by ISO; closes in ISO-assign.
- Binding today: OIDC service-account token (index.ts:504-512); no program principal; wakes params.target for activeUserIds[0].
- Evidence: POST /v1/internal/wake-target reads params.target (index.ts:615, :630) and calls wakeTarget with userId = activeUserIds[0]; the caller is a service account, not a program credential.
- Recommendation: ADDRESSED (target names who to wake; the response carries an outcome only). ISO to confirm the service-account path needs no principal.

### `ack-compliance.getAckComplianceHandler:args.programId`

- Where: `modules/ack-compliance.ts`, handler `getAckComplianceHandler`, expression `args.programId`, line 112 at base, 3 occurrence(s).
- Tool: audit_get_ack_compliance; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none: args.programId filters query on source (ack-compliance.ts:112-114).
- Evidence: No comparison against auth.programId, credentialPrincipal or a capability inside the handler (guard grep, recon section 8). Any caller can filter the ledger to another program's source.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `audit.getAuditHandler:args.programId`

- Where: `modules/audit.ts`, handler `getAuditHandler`, expression `args.programId`, line 46 at base, 2 occurrence(s).
- Tool: audit_get_audit; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-L.
- Binding today: isAdmin(auth) (name list) or hasCapability audit.read (wildcard-satisfiable), audit.ts:26.
- Name lists: NL-ADMIN-PROGRAMS.
- Evidence: Gate at audit.ts:26 passes for the five isAdmin names or any key with audit.read or "*". Once past the gate, args.programId filters any program's ledger rows.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled. Literal membership in PR-N.

### `clu.cluIngestHandler:parsed.session_id`

- Where: `modules/clu.ts`, handler `cluIngestHandler`, expression `parsed.session_id`, line 92 at base, 1 occurrence(s).
- Tool: clu_ingest; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: clu.ts:92 takes parsed.session_id or generates one and writes the ingestion under tenants/{auth.userId}/...; no owner field and no principal comparison.
- Recommendation: ATTRIBUTION if ingestion documents carry no program ownership; otherwise SELF-ONLY. Evidence for ownership was not found in clu.ts.

### `clu.cluAnalyzeHandler:parsed.session_id`

- Where: `modules/clu.ts`, handler `cluAnalyzeHandler`, expression `parsed.session_id`, line 137 at base, 3 occurrence(s).
- Tool: clu_analyze; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: The handler reads nothing from the id (clu.ts:125-175). It writes caller data to clu_sessions/{id}/analyses (clu.ts:155-162) under a caller-chosen id; nothing compares the id to the caller.
- Recommendation: Write family: FOREIGN-WRITE on literal fleet.admin for another principal's clu session; SELF-ONLY when unruled. No FOREIGN-READ applies because the handler reads no document by this id.

### `claims.claimTaskHandler:args.sessionId`

- Where: `modules/dispatch/claims.ts`, handler `claimTaskHandler`, expression `args.sessionId`, line 96 at base, 5 occurrence(s).
- Tool: dispatch_claim_task; transports mcp, rest, iso; effect write; decided by ISO; closes in PR-K.
- Binding today: isTaskOwner (dispatch/shared.ts): claimedBy equals credentialPrincipal, or claimedBy "dispatcher" and sessionId equals the principal. sessionId is attribution; a missing sessionId never matches. claimedBy is written from credentialPrincipal only (RD-5 PR-K, plan 19.1)..
- Evidence: args.sessionId is stored on the claim (claims.ts:97 (single claim at :96, batch at :311)) and compared by later calls: claims.ts:76 treats an equal sessionId as an idempotent re-claim and returns the task data to a different program, and completion.ts:537, completion.ts:870 and claims.ts:190 accept data.sessionId === auth.programId as ownership. A caller-chosen value therefore enters two authorization comparisons.
- Recommendation: Remove sessionId from every authorization comparison; claimedBy is the owner. Label sessionId ATTRIBUTION after that.

### `claims.batchClaimTasksHandler:args.sessionId`

- Where: `modules/dispatch/claims.ts`, handler `batchClaimTasksHandler`, expression `args.sessionId`, line 303 at base, 3 occurrence(s).
- Tool: dispatch_batch_claim_tasks; transports mcp, rest; effect write; decided by ISO; closes in PR-K.
- Binding today: same as dispatch_claim_task (isTaskOwner, claims.ts).
- Evidence: args.sessionId is stored on the claim (claims.ts:313 (single claim at :96, batch at :311)) and compared by later calls: claims.ts:76 treats an equal sessionId as an idempotent re-claim and returns the task data to a different program, and completion.ts:537, completion.ts:870 and claims.ts:190 accept data.sessionId === auth.programId as ownership. A caller-chosen value therefore enters two authorization comparisons.
- Recommendation: Same as dispatch_claim_task.

### `dispatchHandler.dispatchHandler:args.source`

- Where: `modules/dispatch/dispatchHandler.ts`, handler `dispatchHandler`, expression `args.source`, line 780 at base, 1 occurrence(s).
- Tool: dispatch_dispatch; transports mcp, rest; effect write; decided by C-5; closes in PR-K.
- Binding today: verifySource against credentialPrincipal; only mobile may name another source (gate.ts SOURCE_ANY_PRINCIPALS).
- Name lists: NL-VERIFYSOURCE-ADMIN.
- Evidence: dispatchHandler.ts:780 calls verifySource. verifySource returns claimedSource unchecked for credentials named legacy or mobile.
- Recommendation: ATTRIBUTION or ADDRESSED sender binding after VECTOR rules on legacy and mobile (C-5).

### `interventions.retryTaskHandler:args.newTarget`

- Where: `modules/dispatch/interventions.ts`, handler `retryTaskHandler`, expression `args.newTarget`, line 81 at base, 6 occurrence(s).
- Tool: dispatch_retry_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none: newTarget only checked against the program registry (interventions.ts:81-86).
- Evidence: The handler re-targets any task id in the tenant. No comparison of the task owner to the caller.
- Recommendation: SELF-ONLY on task ownership (source or claimedBy equals the principal); FOREIGN-WRITE only on literal fleet.admin. The new target itself is ADDRESSED.

### `interventions.reassignTaskHandler:args.newTarget`

- Where: `modules/dispatch/interventions.ts`, handler `reassignTaskHandler`, expression `args.newTarget`, line 283 at base, 7 occurrence(s).
- Tool: dispatch_reassign_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none beyond registry check (interventions.ts:283-286).
- Evidence: Moves any task in the tenant to another program. No owner or principal comparison (zero === or !== on auth.programId in the file, recon section 8).
- Recommendation: SELF-ONLY on task ownership (source or claimedBy equals the principal); FOREIGN-WRITE only on literal fleet.admin. The new target itself is ADDRESSED.

### `interventions.escalateTaskHandler:args.escalateTo`

- Where: `modules/dispatch/interventions.ts`, handler `escalateTaskHandler`, expression `args.escalateTo`, line 395 at base, 4 occurrence(s).
- Tool: dispatch_escalate_task; transports mcp; effect write; decided by C-5; closes in PR-L.
- Binding today: none beyond registry check; default target from a name list (interventions.ts:374-385).
- Name lists: NL-ESCALATION-CHAIN.
- Evidence: escalateTo is registry-validated at interventions.ts:395-399. When absent, getDefaultEscalationTarget picks from a hardcoded chain (iso, orchestrator, vector, dispatcher, legacy).
- Recommendation: ADDRESSED for escalateTo; the chain is routing, not a gate. Task ownership is the open question (see the args.taskId record).

### `interventions.quarantineProgramHandler:args.programId`

- Where: `modules/dispatch/interventions.ts`, handler `quarantineProgramHandler`, expression `args.programId`, line 507 at base, 7 occurrence(s).
- Tool: dispatch_quarantine_program; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none in handler; tool capability fleet.control, wildcard-satisfiable.
- Evidence: interventions.ts:507-512 checks only that the program exists, then sets quarantine on programs/{id}. Any key with fleet.control or "*" can stop any program's intake.
- Recommendation: FOREIGN-WRITE on literal fleet.admin. A wrong SELF-ONLY here removes the dispatcher's quarantine path; hold for C-5 if the dispatcher uses it.

### `interventions.unquarantineProgramHandler:args.programId`

- Where: `modules/dispatch/interventions.ts`, handler `unquarantineProgramHandler`, expression `args.programId`, line 571 at base, 7 occurrence(s).
- Tool: dispatch_unquarantine_program; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: same as dispatch_quarantine_program.
- Evidence: interventions.ts:571-576, same shape as quarantine.
- Recommendation: Same as dispatch_quarantine_program.

### `interventions.replayTaskHandler:args.newTarget`

- Where: `modules/dispatch/interventions.ts`, handler `replayTaskHandler`, expression `args.newTarget`, line 639 at base, 7 occurrence(s).
- Tool: dispatch_replay_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none beyond registry check.
- Evidence: interventions.ts:639-642 reads any task by id and clones it to newTarget. No owner comparison.
- Recommendation: SELF-ONLY on task ownership (source or claimedBy equals the principal); FOREIGN-WRITE only on literal fleet.admin. The new target itself is ADDRESSED.

### `tasks.getTasksHandler:args.target`

- Where: `modules/dispatch/tasks.ts`, handler `getTasksHandler`, expression `args.target`, line 168 at base, 6 occurrence(s).
- Tool: dispatch_get_tasks; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-K.
- Binding today: authorizeTasksRead (dispatch/tasks.ts): no target allowed; target equal to the principal or "all" allowed; TASKS_ALL_PRINCIPALS (mobile, dispatcher) and literal fleet.observe may name any target; no-target default is own queue plus broadcast except TASKS_ALL_PRINCIPALS. Sprint types skip the filter (K-D5, known-open T2.dispatch_get_tasks_sprint, PR-L)..
- Name lists: NL-GETTASKS-DEFAULT.
- Evidence: tasks.ts:155 filters by any target without comparison. tasks.ts:158-159 skips the own-queue default for three names. Dispatch polling by the dispatcher depends on the unscoped read.
- Recommendation: FOREIGN-READ on literal fleet.observe for an explicit foreign target; SELF-ONLY default. Order matters: the flip lands only after iso and the dispatcher hold literal fleet.observe. Today only vector and sark hold it (ownerAuthz.ts:149-152), so an earlier flip denies the dispatcher poll and iso. The dispatcher's use also needs the C-5 ruling.

### `tasks.createTaskHandler:args.source`

- Where: `modules/dispatch/tasks.ts`, handler `createTaskHandler`, expression `args.source`, line 428 at base, 1 occurrence(s).
- Tool: dispatch_create_task; transports mcp, rest, iso; effect write; decided by C-5; closes in PR-K.
- Binding today: verifySource against credentialPrincipal; only mobile may name another source.
- Name lists: NL-VERIFYSOURCE-ADMIN.
- Evidence: tasks.ts:410 calls verifySource.
- Recommendation: ATTRIBUTION or ADDRESSED sender binding after C-5.

### `gsp.gspWriteHandler:args.source`

- Where: `modules/gsp.ts`, handler `gspWriteHandler`, expression `args.source`, line 434 at base, 1 occurrence(s).
- Tool: gsp_write; transports mcp, rest; effect write; decided by C-5; closes in PR-L.
- Binding today: verifySource against credentialPrincipal (PR-K, gate.ts); only mobile may name another source.
- Name lists: NL-VERIFYSOURCE-ADMIN.
- Evidence: gsp.ts:433 calls verifySource and stores the result as updatedBy. Which program may write which namespace is not checked anywhere in gspWriteHandler.
- Recommendation: ATTRIBUTION for source after C-5. Namespace write authority is a separate question for ISO (ruling HpgeGWU8).

### `keys.revokeKeyHandler:keyHash`

- Where: `modules/keys.ts`, handler `revokeKeyHandler`, expression `keyHash`, line 153 at base, 1 occurrence(s).
- Tool: keys_revoke_key; transports mcp, rest; effect write; decided by C-5; closes in PR-F.
- Binding today: auth/authorize.ts authorizeKeySubject: sameTenant (both sides through resolveTenant) AND (sameProgram OR isKeyAdmin); a tenant mismatch answers "Key not found" (PR-E). isKeyAdmin is literal fleet.admin only; a key document with no programId is denied with reason "program" (PR-F)..
- Evidence: The tenant check is satisfied by every key (one tenant). Key administration comes from a literal fleet.admin on the credential: the KEY_ADMIN_PRINCIPALS list and keys.admin were deleted in PR-F. C-2 ruled the principal (tenant, program) with fleet.admin as the widening.
- Recommendation: FOREIGN-WRITE on literal fleet.admin per C-2 (PR-E). The name list is gone (PR-F).

### `metrics.getProgramHealthHandler:args.programId`

- Where: `modules/metrics.ts`, handler `getProgramHealthHandler`, expression `args.programId`, line 862 at base, 3 occurrence(s).
- Tool: metrics_get_program_health; transports mcp; effect read; decided by C-5; closes in PR-L.
- Binding today: isAdmin(auth) (name list) or hasCapability metrics.read (wildcard-satisfiable), metrics.ts:848.
- Name lists: NL-ADMIN-PROGRAMS.
- Evidence: After the gate, args.programId filters completed tasks by target (metrics.ts:862-864).
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `programRegistry.updateProgramHandler:args.programId`

- Where: `modules/programRegistry.ts`, handler `updateProgramHandler`, expression `args.programId`, line 392 at base, 7 occurrence(s).
- Tool: programs_update_program; transports mcp; effect write; decided by C-5; closes in PR-L.
- Binding today: inline name list on auth.programId, or self (programRegistry.ts:400-405).
- Name lists: NL-REGISTRY-ADMIN.
- Evidence: Six hardcoded names (legacy, mobile, orchestrator, iso, vector, dispatcher) may edit any program entry (role, groups, tags). auth.programId is the mutable field while the override path exists.
- Recommendation: SELF-ONLY; FOREIGN-WRITE only on literal fleet.admin (D-d).

### `pulse.createSessionHandler:args.sessionId`

- Where: `modules/pulse.ts`, handler `createSessionHandler`, expression `args.sessionId`, line 113 at base, 3 occurrence(s).
- Tool: pulse_create_session; transports mcp, rest; effect write; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: pulse.ts:113 creates a session document under a caller-chosen id. update_session binds writes by id prefix; create does not bind the prefix to the caller. The write is .set() without merge (pulse.ts:173), so it overwrites any program's existing session document.
- Recommendation: Require the session id prefix to equal the principal, as update_session does (SELF-ONLY).

### `pulse.createSessionHandler:args.programId`

- Where: `modules/pulse.ts`, handler `createSessionHandler`, expression `args.programId`, line 122 at base, 1 occurrence(s).
- Tool: pulse_create_session; transports mcp, rest; effect write; decided by C-5; closes in PR-L.
- Binding today: none; skipped for legacy and mobile at pulse.ts:184.
- Name lists: NL-PULSE-REGISTRY-SKIP.
- Evidence: pulse.ts:155 writes args.programId into the session and, at :144 onward, piggybacks a write to programs/{programId} (lastHeartbeat). Any caller can touch another program's registry entry.
- Recommendation: programId derives from the principal (SELF-ONLY).

### `pulse.updateSessionHandler:args.sessionId`

- Where: `modules/pulse.ts`, handler `updateSessionHandler`, expression `args.sessionId`, line 216 at base, 1 occurrence(s).
- Tool: pulse_update_session; transports mcp, rest, iso; effect write; decided by C-5; closes in PR-L.
- Binding today: session id prefix equals auth.programId unless legacy, mobile or dispatcher (pulse.ts:245-257); denial names auth.programId.
- Name lists: NL-PULSE-PRIV.
- Evidence: SARK C2 gate. auth.programId is the mutable field while the override path exists, and three names skip the gate.
- Recommendation: SELF-ONLY on credentialPrincipal; dispatcher use needs the C-5 table.

### `pulse.listSessionsHandler:args.programId`

- Where: `modules/pulse.ts`, handler `listSessionsHandler`, expression `args.programId`, line 747 at base, 1 occurrence(s).
- Tool: pulse_list_sessions; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none in handler; REST route adds requireAdmin (rest.ts:516).
- Evidence: pulse.ts:764 filters by any program; absent lists all. The MCP and ISO transports reach it with no gate.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `pulse.getContextUtilizationHandler:args.sessionId`

- Where: `modules/pulse.ts`, handler `getContextUtilizationHandler`, expression `args.sessionId`, line 845 at base, 5 occurrence(s).
- Tool: pulse_get_context_utilization; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: pulse.ts:845 reads any session's contextHistory by id; absent returns all active sessions.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `pulse.pauseProgramHandler:args.programId`

- Where: `modules/pulse.ts`, handler `pauseProgramHandler`, expression `args.programId`, line 951 at base, 9 occurrence(s).
- Tool: pulse_pause_program; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none in handler; tool capability pulse.write.
- Evidence: pulse.ts:958-963 sets programs/{id}.paused for any registered program. C-3 adds a separate dispatchPaused flag; this site is the per-program flag.
- Recommendation: FOREIGN-WRITE on literal fleet.admin.

### `pulse.resumeProgramHandler:args.programId`

- Where: `modules/pulse.ts`, handler `resumeProgramHandler`, expression `args.programId`, line 1021 at base, 12 occurrence(s).
- Tool: pulse_resume_program; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none in handler; tool capability pulse.write.
- Evidence: pulse.ts:1028-1033, same shape as pause.
- Recommendation: FOREIGN-WRITE on literal fleet.admin.

### `rate-limits.getRateLimitEventsHandler:args.sessionId`

- Where: `modules/rate-limits.ts`, handler `getRateLimitEventsHandler`, expression `args.sessionId`, line 105 at base, 2 occurrence(s).
- Tool: metrics_get_rate_limit_events; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: rate-limits.ts:105-106 filters events by any session id; events carry the writing program.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `relay.sendMessageHandler:args.source`

- Where: `modules/relay.ts`, handler `sendMessageHandler`, expression `args.source`, line 142 at base, 3 occurrence(s).
- Tool: relay_send_message; transports mcp, rest, iso; effect write; decided by C-5; closes in PR-K.
- Binding today: verifySource against credentialPrincipal; only mobile may name another source.
- Name lists: NL-VERIFYSOURCE-ADMIN.
- Evidence: relay.ts:141 verifySource, :304 reuse.
- Recommendation: ATTRIBUTION or ADDRESSED sender binding after C-5.

### `relay.getMessagesHandler:args.sessionId`

- Where: `modules/relay.ts`, handler `getMessagesHandler`, expression `args.sessionId`, line 481 at base, 2 occurrence(s).
- Tool: relay_get_messages; transports mcp, rest, iso; effect mixed; decided by C-5; closes in PR-K.
- Binding today: authorizeRelayRead (relay.ts): a sessionId that names another registered program is a subject (K-D2 option 2); a restricted key reading another subject is denied before query.get().
- Name lists: NL-RELAY-GETMSG.
- Evidence: args.sessionId is the fallback requestedTarget (relay.ts:475). Reads and, by default, marks messages delivered.
- Recommendation: SELF-ONLY with explicit denial naming the principal (predecessor R6); broadcast reads must not transition state (R6a). Keep the dispatcher exemption (relay.ts:478): C-5 rule 1 holds the dispatcher's memberships until the REST routes write ledger rows.

### `relay.getMessagesHandler:args.target`

- Where: `modules/relay.ts`, handler `getMessagesHandler`, expression `args.target`, line 481 at base, 2 occurrence(s).
- Tool: relay_get_messages; transports mcp, rest, iso; effect mixed; decided by C-5; closes in PR-K.
- Binding today: authorizeRelayRead (relay.ts): self and "all" allowed; RELAY_READ_ALL_PRINCIPALS (mobile, dispatcher) read any inbox; every other foreign target is denied naming credentialPrincipal.
- Name lists: NL-RELAY-GETMSG.
- Evidence: relay.ts:475, same filter. For the three named credentials the filter honours the requested target.
- Recommendation: Same as the args.sessionId record, including the dispatcher exemption (relay.ts:478, C-5 rule 1).

### `relay.getSentMessagesHandler:args.source`

- Where: `modules/relay.ts`, handler `getSentMessagesHandler`, expression `args.source`, line 653 at base, 1 occurrence(s).
- Tool: relay_get_sent_messages; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-K.
- Binding today: source defaults to credentialPrincipal; a foreign source needs RELAY_ADMIN_PRINCIPALS (mobile, dispatcher), else denied naming credentialPrincipal (K-D3 option 1).
- Name lists: NL-ADMIN-PROGRAMS, NL-RELAY-ADMIN.
- Evidence: isAdmin is the five-name list in gate.ts:132.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `relay.queryMessageHistoryHandler:args.source`

- Where: `modules/relay.ts`, handler `queryMessageHistoryHandler`, expression `args.source`, line 787 at base, 8 occurrence(s).
- Tool: relay_query_message_history; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-K.
- Binding today: privileged is RELAY_ADMIN_PRINCIPALS (mobile, dispatcher); else self is credentialPrincipal (K-D3 option 1).
- Name lists: NL-ADMIN-PROGRAMS, NL-RELAY-ADMIN.
- Evidence: Participant scoping coerces non-admin callers to self. The admin bypass is the five-name list.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `relay.queryMessageHistoryHandler:args.target`

- Where: `modules/relay.ts`, handler `queryMessageHistoryHandler`, expression `args.target`, line 787 at base, 9 occurrence(s).
- Tool: relay_query_message_history; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-K.
- Binding today: same as args.source record.
- Name lists: NL-ADMIN-PROGRAMS, NL-RELAY-ADMIN.
- Evidence: relay.ts:761-767 same scoping.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `schedule.createScheduleHandler:args.target`

- Where: `modules/schedule.ts`, handler `createScheduleHandler`, expression `args.target`, line 128 at base, 2 occurrence(s).
- Tool: schedule_create; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none; createdBy = auth.programId (schedule.ts:141).
- Evidence: schedule.ts:128 stores the target. The task the executor later creates uses source "scheduler" (schedule-executor.ts:115), so the creating program is not carried to the recipient as the sender.
- Recommendation: ADDRESSED for target. Sender attribution for scheduled work is the open item.

### `schedule.paginateAndFilter:args.target`

- Where: `modules/schedule.ts`, handler `paginateAndFilter`, expression `args.target`, line 186 at base, 2 occurrence(s).
- Tool: schedule_list; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: Helper of schedule_list; filters in memory by target (schedule.ts:186).
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `schedule.listSchedulesHandler:args.target`

- Where: `modules/schedule.ts`, handler `listSchedulesHandler`, expression `args.target`, line 200 at base, 3 occurrence(s).
- Tool: schedule_list; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: schedule.ts:200-204 lists any target's schedules.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `schedule.updateScheduleHandler:args.target`

- Where: `modules/schedule.ts`, handler `updateScheduleHandler`, expression `args.target`, line 296 at base, 2 occurrence(s).
- Tool: schedule_update; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none.
- Evidence: schedule.ts:296 re-targets a schedule found by id. No createdBy comparison.
- Recommendation: SELF-ONLY on createdBy; FOREIGN-WRITE on literal fleet.admin.

### `sprint.createSprintHandler:args.sessionId`

- Where: `modules/sprint.ts`, handler `createSprintHandler`, expression `args.sessionId`, line 183 at base, 1 occurrence(s).
- Tool: sprint_create_sprint; transports mcp, rest; effect write; decided by ISO; closes in PR-K.
- Binding today: stored as attribution only; ownership is isTaskOwner, which needs claimedBy, and a sprint parent has none (K-D1).
- Evidence: sprint.ts:183 stores args.sessionId on a task with status "active". completion.ts:537, completion.ts:870 and claims.ts:190 accept data.sessionId === auth.programId as ownership, so the program a caller names in sessionId can complete or unclaim the sprint task.
- Recommendation: Remove sessionId from every ownership comparison (same change as hole a, dispatch_claim_task). Label ATTRIBUTION only after that. The sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164), so no owner check can substitute.

### `trace.queryTracesHandler:args.programId`

- Where: `modules/trace.ts`, handler `queryTracesHandler`, expression `args.programId`, line 218 at base, 2 occurrence(s).
- Tool: trace_query_traces; transports mcp, rest, iso; effect read; decided by C-5; closes in PR-L.
- Binding today: isAdmin(auth) name list (trace.ts:200).
- Name lists: NL-ADMIN-PROGRAMS.
- Evidence: After the isAdmin gate, args.programId filters ledger traces (trace.ts:218-219).
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `onDemandWake.wakeTarget:userId,target,callerSource`

- Where: `modules/wake/onDemandWake.ts`, handler `wakeTarget`, expression `userId,target,callerSource`, line 208 at base, 1 occurrence(s).
- Tool: none; transports internal; effect write; decided by ISO; closes in ISO-assign.
- Binding today: none in function; callers: relay.ts:303, dispatch, index.ts:625.
- Evidence: wakeTarget takes a tenant userId, a target and a callerSource label and has no principal parameter. Callers pass a validated target (ADDRESSED) or a service-account request (index.ts:613).
- Recommendation: ADDRESSED for target, ATTRIBUTION for callerSource; the open item is the internal route's lack of a principal (see the index.ts record).

### `CustomHTTPTransport.(module):parsed.sessionId`

- Where: `transport/CustomHTTPTransport.ts`, handler `(module)`, expression `parsed.sessionId`, line 130 at base, 9 occurrence(s).
- Tool: none; transports none; effect read; decided by ISO; closes in ISO-assign.
- Binding today: none; caller-chosen header, an invalid id still proceeds (CustomHTTPTransport.ts:147-150).
- Evidence: parsed.sessionId comes from a caller-chosen header. An invalid id proceeds under Bearer auth (:147-150). A heartbeat updates sessions/{header}.lastHeartbeat for any program in the tenant (:159). DELETE removes any mcp_sessions document in the tenant (:230). It is an identity-selecting argument, not protocol framing alone.
- Recommendation: Bind the header id to the principal that created the MCP session (SELF-ONLY on session ownership) before the heartbeat write and the DELETE. ISO to assign the PR.

### `rest.route GET /v1/tasks/stats:query.target`

- Where: `transport/rest.ts`, handler `route GET /v1/tasks/stats`, expression `query.target`, line 327 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by C-5; closes in PR-M.
- Binding today: requireAdmin: "*" or ADMIN_READERS (rest.ts:133-139, :323).
- Name lists: NL-ADMIN-READERS.
- Evidence: Counts any target's tasks by querying Firestore directly (rest.ts:325-340); no MCP handler, so no capability gate, breaker or audit.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled. Route through callTool or authorizeSubject (PDR 4.5).

### `rest.route GET /v1/messages/unread:query.sessionId`

- Where: `transport/rest.ts`, handler `route GET /v1/messages/unread`, expression `query.sessionId`, line 426 at base, 2 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none.
- Evidence: rest.ts:423-429 queries relay documents directly. With query.sessionId it filters target equal to that value; without it, returns every pending message in the tenant (limit 50). No principal check.
- Recommendation: SELF-ONLY; the widest unauthenticated-by-principal read in the table.

### `rest.route GET /v1/messages:query.sessionId`

- Where: `transport/rest.ts`, handler `route GET /v1/messages`, expression `query.sessionId`, line 453 at base, 1 occurrence(s).
- Tool: relay_get_messages; transports rest; effect mixed; decided by C-5; closes in PR-K.
- Binding today: delegates to relay_get_messages (authorizeRelayRead decides).
- Name lists: NL-RELAY-GETMSG.
- Evidence: rest.ts:453 passes sessionId (default "rest") into the handler, which applies relay.ts:473-481.
- Recommendation: Disposition follows the relay_get_messages records.

### `rest.route GET /v1/program-state/:programId:p.programId`

- Where: `transport/rest.ts`, handler `route GET /v1/program-state/:programId`, expression `p.programId`, line 790 at base, 1 occurrence(s).
- Tool: state_get_program_state; transports rest; effect read; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_get_program_state; the gate is in the handler.
- Recommendation: Disposition follows the state_get_program_state record.

### `rest.route PATCH /v1/program-state/:programId:p.programId`

- Where: `transport/rest.ts`, handler `route PATCH /v1/program-state/:programId`, expression `p.programId`, line 795 at base, 1 occurrence(s).
- Tool: state_update_program_state; transports rest; effect write; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_update_program_state; the gate is in the handler.
- Recommendation: Disposition follows the state_update_program_state record.

### `rest.route GET /v1/program-state/:programId/context-history:p.programId`

- Where: `transport/rest.ts`, handler `route GET /v1/program-state/:programId/context-history`, expression `p.programId`, line 800 at base, 1 occurrence(s).
- Tool: state_get_context_history; transports rest; effect read; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_get_context_history; the gate is in the handler.
- Recommendation: Disposition follows the state_get_context_history record.

### `rest.route POST /v1/memory/:programId/patterns:p.programId`

- Where: `transport/rest.ts`, handler `route POST /v1/memory/:programId/patterns`, expression `p.programId`, line 807 at base, 1 occurrence(s).
- Tool: state_store_memory; transports rest; effect write; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_store_memory; the gate is in the handler.
- Recommendation: Disposition follows the state_store_memory record.

### `rest.route GET /v1/memory/:programId/patterns:p.programId`

- Where: `transport/rest.ts`, handler `route GET /v1/memory/:programId/patterns`, expression `p.programId`, line 812 at base, 1 occurrence(s).
- Tool: state_recall_memory; transports rest; effect read; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_recall_memory; the gate is in the handler.
- Recommendation: Disposition follows the state_recall_memory record.

### `rest.route DELETE /v1/memory/:programId/patterns/:patternId:p.programId`

- Where: `transport/rest.ts`, handler `route DELETE /v1/memory/:programId/patterns/:patternId`, expression `p.programId`, line 816 at base, 1 occurrence(s).
- Tool: state_delete_memory; transports rest; effect write; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_delete_memory; the gate is in the handler.
- Recommendation: Disposition follows the state_delete_memory record.

### `rest.route PATCH /v1/memory/:programId/patterns/:patternId/reinforce:p.programId`

- Where: `transport/rest.ts`, handler `route PATCH /v1/memory/:programId/patterns/:patternId/reinforce`, expression `p.programId`, line 821 at base, 1 occurrence(s).
- Tool: state_reinforce_memory; transports rest; effect write; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_reinforce_memory; the gate is in the handler.
- Recommendation: Disposition follows the state_reinforce_memory record.

### `rest.route GET /v1/memory/:programId/health:p.programId`

- Where: `transport/rest.ts`, handler `route GET /v1/memory/:programId/health`, expression `p.programId`, line 825 at base, 1 occurrence(s).
- Tool: state_memory_health; transports rest; effect read; decided by C-5; closes in PR-J.
- Binding today: delegates to the handler's canRead or canWrite.
- Evidence: The path segment becomes args.programId for state_memory_health; the gate is in the handler.
- Recommendation: Disposition follows the state_memory_health record.

### `rest.route GET /v1/interrupts/peek:query.sessionId`

- Where: `transport/rest.ts`, handler `route GET /v1/interrupts/peek`, expression `query.sessionId`, line 859 at base, 1 occurrence(s).
- Tool: relay_get_messages; transports rest; effect read; decided by C-5; closes in PR-K.
- Binding today: delegates to relay_get_messages with markAsRead false (authorizeRelayRead decides).
- Name lists: NL-RELAY-GETMSG.
- Evidence: rest.ts:859 passes sessionId (default "peek").
- Recommendation: Disposition follows the relay_get_messages records.

### `rest.route GET /v1/tasks/stats:getFirestore()`

- Where: `transport/rest.ts`, handler `route GET /v1/tasks/stats`, expression `getFirestore()`, line 325 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by C-5; closes in PR-M.
- Binding today: requireAdmin: "*" or ADMIN_READERS (rest.ts:133-139, :323).
- Name lists: NL-ADMIN-READERS.
- Evidence: Counts tasks tenant-wide or by query.target straight from Firestore; skips callTool (no capability gate, breaker, rate limit or audit).
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled. Route through callTool or authorizeSubject (PDR 4.5).

### `rest.route GET /v1/messages/unread:getFirestore()`

- Where: `transport/rest.ts`, handler `route GET /v1/messages/unread`, expression `getFirestore()`, line 423 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none.
- Evidence: Lists pending relay documents straight from Firestore; with no sessionId it returns every pending message in the tenant (limit 50).
- Recommendation: SELF-ONLY by principal; route through callTool.

### `rest.route POST /v1/messages/mark_read:getFirestore()`

- Where: `transport/rest.ts`, handler `route POST /v1/messages/mark_read`, expression `getFirestore()`, line 440 at base, 1 occurrence(s).
- Tool: none; transports rest; effect write; decided by ISO; closes in PR-M.
- Binding today: enforceBreaker on relay_mark_read (capability, wildcard-satisfiable); no ownership check (rest.ts:433-445).
- Evidence: Marks up to 100 caller-supplied relay document ids read in the tenant. Does not compare the document target to the caller.
- Recommendation: SELF-ONLY on the message target; broadcast documents must not transition (PDR section 6).

### `rest.route GET /v1/sessions/history:getFirestore()`

- Where: `transport/rest.ts`, handler `route GET /v1/sessions/history`, expression `getFirestore()`, line 537 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by C-5; closes in PR-M.
- Binding today: requireAdmin (rest.ts:535).
- Name lists: NL-ADMIN-READERS.
- Evidence: Lists archived sessions tenant-wide; no identifier argument.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `rest.route GET /v1/sprints/active:getFirestore()`

- Where: `transport/rest.ts`, handler `route GET /v1/sprints/active`, expression `getFirestore()`, line 607 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by C-5; closes in PR-M.
- Binding today: requireAdmin (rest.ts:606).
- Name lists: NL-ADMIN-READERS.
- Evidence: Lists active sprint tasks tenant-wide; no identifier argument.
- Recommendation: FOREIGN-READ gated on literal fleet.observe (PDR 4.3); SELF-ONLY when unruled.

### `rest.route GET /v1/gsp/proposals:getFirestore()`

- Where: `transport/rest.ts`, handler `route GET /v1/gsp/proposals`, expression `getFirestore()`, line 753 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none.
- Evidence: Lists GSP proposals for the tenant straight from Firestore; filter by status only. The tenant segment is auth.userId (rest.ts:754).
- Recommendation: Disposition follows the gsp_resolve and gsp_propose records; route through callTool.

### `rest.route GET /v1/budget/summary:budgetSummaryHandler`

- Where: `transport/rest.ts`, handler `route GET /v1/budget/summary`, expression `budgetSummaryHandler()`, line 670 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry.
- Evidence: Calls budgetSummaryHandler directly (rest.ts:669-671); no capability gate, breaker, rate limit or audit.
- Recommendation: Route through callTool so the capability gate, breaker and audit apply (PDR 4.5); disposition then follows the handler.

### `rest.route GET /v1/dreams:dreamPeekHandler`

- Where: `transport/rest.ts`, handler `route GET /v1/dreams`, expression `dreamPeekHandler()`, line 711 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry.
- Evidence: Calls dreamPeekHandler directly; skips callTool.
- Recommendation: Route through callTool so the capability gate, breaker and audit apply (PDR 4.5); disposition then follows the handler.

### `rest.route GET /v1/gsp/namespaces:gspListNamespacesHandler`

- Where: `transport/rest.ts`, handler `route GET /v1/gsp/namespaces`, expression `gspListNamespacesHandler()`, line 733 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry.
- Evidence: Calls gspListNamespacesHandler directly; skips callTool. Lists namespace names and entry counts for the tenant.
- Recommendation: Route through callTool so the capability gate, breaker and audit apply (PDR 4.5); disposition then follows the handler.

### `rest.route GET /v1/dreams/peek:dreamPeekHandler`

- Where: `transport/rest.ts`, handler `route GET /v1/dreams/peek`, expression `dreamPeekHandler()`, line 863 at base, 1 occurrence(s).
- Tool: none; transports rest; effect read; decided by ISO; closes in PR-M.
- Binding today: none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry.
- Evidence: Legacy duplicate of GET /v1/dreams; calls dreamPeekHandler directly.
- Recommendation: Route through callTool so the capability gate, breaker and audit apply (PDR 4.5); disposition then follows the handler.

### `rest.createRestRouter:enrollHandler`

- Where: `transport/rest.ts`, handler `createRestRouter`, expression `enrollHandler(req, res)`, line 980 at base, 1 occurrence(s).
- Tool: none; transports rest; effect write; decided by ISO; closes in PR-M.
- Binding today: none: public pre-auth route /enroll; identity comes from the enrollment token document (enrollment.ts:113, :178-179).
- Evidence: rest.ts:980 hands /enroll to enrollHandler before authentication and without callTool. The handler exchanges a one-time token for a cb_ key: tenant from the enrollment document, program fixed to ENROLLMENT_PROGRAM_ID, no request argument selects either. Not in the recon (amendment 2).
- Recommendation: NOT-IDENTITY for the arguments (the principal is created, not read). ISO to confirm the unauthenticated route is intended.

### `interventions.abortTaskHandler:args.taskId`

- Where: `modules/dispatch/interventions.ts`, handler `abortTaskHandler`, expression `args.taskId`, line n/a at base, 1 occurrence(s).
- Tool: dispatch_abort_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: abortTaskHandler (interventions.ts:195) aborts any task id in the tenant; it records abortedBy: auth.programId but compares nothing to the task owner.
- Recommendation: SELF-ONLY on object ownership (creator or claimant equals the principal); FOREIGN-WRITE only on literal fleet.admin.

### `interventions.escalateTaskHandler:args.taskId`

- Where: `modules/dispatch/interventions.ts`, handler `escalateTaskHandler`, expression `args.taskId`, line n/a at base, 1 occurrence(s).
- Tool: dispatch_escalate_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: escalateTaskHandler (interventions.ts:390) re-routes any task id; escalatedBy is recorded, not compared.
- Recommendation: SELF-ONLY on object ownership (creator or claimant equals the principal); FOREIGN-WRITE only on literal fleet.admin.

### `interventions.approveTaskHandler:args.taskId`

- Where: `modules/dispatch/interventions.ts`, handler `approveTaskHandler`, expression `args.taskId`, line n/a at base, 1 occurrence(s).
- Tool: dispatch_approve_task; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: approveTaskHandler (interventions.ts) approves any pending task id; no approver or owner comparison found.
- Recommendation: SELF-ONLY on object ownership (creator or claimant equals the principal); FOREIGN-WRITE only on literal fleet.admin.

### `tasks.getTaskByIdHandler:args.taskId`

- Where: `modules/dispatch/tasks.ts`, handler `getTaskByIdHandler`, expression `args.taskId`, line n/a at base, 1 occurrence(s).
- Tool: dispatch_get_task_by_id; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: getTaskByIdHandler (tasks.ts:567) returns any task document in the tenant by id.
- Recommendation: FOREIGN-READ gated on literal fleet.observe; SELF-ONLY on object ownership when unruled.

### `schedule.getScheduleHandler:args.scheduleId`

- Where: `modules/schedule.ts`, handler `getScheduleHandler`, expression `args.scheduleId`, line n/a at base, 1 occurrence(s).
- Tool: schedule_get; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: getScheduleHandler returns any schedule by id; createdBy is stored (schedule.ts:141) but not compared.
- Recommendation: FOREIGN-READ gated on literal fleet.observe; SELF-ONLY on object ownership when unruled.

### `schedule.deleteScheduleHandler:args.scheduleId`

- Where: `modules/schedule.ts`, handler `deleteScheduleHandler`, expression `args.scheduleId`, line n/a at base, 1 occurrence(s).
- Tool: schedule_delete; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: deleteScheduleHandler deletes any schedule by id; no createdBy comparison.
- Recommendation: SELF-ONLY on object ownership (creator or claimant equals the principal); FOREIGN-WRITE only on literal fleet.admin.

### `webhook.webhookDeleteHandler:args.webhookId`

- Where: `modules/webhook.ts`, handler `webhookDeleteHandler`, expression `args.webhookId`, line n/a at base, 1 occurrence(s).
- Tool: webhook_delete; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: webhookDeleteHandler deletes any webhook by id; createdBy is stored (webhook.ts:130), not compared.
- Recommendation: SELF-ONLY on object ownership (creator or claimant equals the principal); FOREIGN-WRITE only on literal fleet.admin.

### `policy.createPolicy:args.id`

- Where: `modules/policy.ts`, handler `createPolicy`, expression `args.id`, line n/a at base, 1 occurrence(s).
- Tool: policy_create; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: createPolicy stores a policy under a caller-chosen id (PolicySchema, policy.ts:96-107).
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: either PR-L adds a creator-program field written from credentialPrincipal (then SELF-ONLY on that field, existing policies need a backfill rule), or writes gate on literal fleet.admin alone. Do not build a check on createdBy.

### `policy.updatePolicy:args.policyId`

- Where: `modules/policy.ts`, handler `updatePolicy`, expression `args.policyId`, line n/a at base, 1 occurrence(s).
- Tool: policy_update; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: updatePolicy edits any policy by id; no owner comparison.
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: either PR-L adds a creator-program field written from credentialPrincipal (then SELF-ONLY on that field, existing policies need a backfill rule), or writes gate on literal fleet.admin alone. Do not build a check on createdBy.

### `policy.deletePolicy:args.policyId`

- Where: `modules/policy.ts`, handler `deletePolicy`, expression `args.policyId`, line n/a at base, 1 occurrence(s).
- Tool: policy_delete; transports mcp; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: deletePolicy removes any policy by id; no owner comparison.
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: either PR-L adds a creator-program field written from credentialPrincipal (then SELF-ONLY on that field, existing policies need a backfill rule), or writes gate on literal fleet.admin alone. Do not build a check on createdBy.

### `policy.getPolicy:args.policyId`

- Where: `modules/policy.ts`, handler `getPolicy`, expression `args.policyId`, line n/a at base, 1 occurrence(s).
- Tool: policy_get; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: getPolicy returns any policy by id.
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: reads gate on literal fleet.observe, with a SELF-ONLY scope only after a creator-program field exists. Do not build a check on createdBy.

### `policy.listPolicies:(tenant-wide)`

- Where: `modules/policy.ts`, handler `listPolicies`, expression `(tenant-wide)`, line n/a at base, 1 occurrence(s).
- Tool: policy_list; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: listPolicies returns every policy in the tenant; no identifier argument.
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: reads gate on literal fleet.observe, with a SELF-ONLY scope only after a creator-program field exists. Do not build a check on createdBy.

### `policy.policyCheck:(tenant-wide)`

- Where: `modules/policy.ts`, handler `policyCheck`, expression `(tenant-wide)`, line n/a at base, 1 occurrence(s).
- Tool: policy_check; transports mcp; effect read; decided by ISO; closes in PR-L.
- Binding today: none; the stored creator is the tenant uid (policy.ts:208, :285), not a program.
- Evidence: policyCheck evaluates caller-supplied action fields against every tenant policy; no identifier selects data.
- Recommendation: No owner field exists: createdBy and updatedBy hold auth.userId, the shared tenant uid (policy.ts:208, :285), so a creator check passes every caller. ESCALATE to ISO: reads gate on literal fleet.observe, with a SELF-ONLY scope only after a creator-program field exists. Do not build a check on createdBy.

### `sprint.updateStoryHandler:args.sprintId`

- Where: `modules/sprint.ts`, handler `updateStoryHandler`, expression `args.sprintId`, line n/a at base, 1 occurrence(s).
- Tool: sprint_update_sprint_story; transports mcp, rest; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164).
- Evidence: updateStoryHandler mutates a story in any sprint id. The sprint document stores source "orchestrator" (sprint.ts:164) and no creator; sprint.ts:331 is a TASK_RETRIED event that carries auth.programId, not a stored owner.
- Recommendation: No owner field exists on the sprint document (source is the literal "orchestrator", sprint.ts:164), so no owner check can be built. ESCALATE to ISO: writes gate on literal fleet.admin, or PR-L adds a creator-program field first.

### `sprint.addStoryHandler:args.sprintId`

- Where: `modules/sprint.ts`, handler `addStoryHandler`, expression `args.sprintId`, line n/a at base, 1 occurrence(s).
- Tool: sprint_add_story_to_sprint; transports mcp, rest; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164).
- Evidence: addStoryHandler adds a story to any sprint id; no owner comparison.
- Recommendation: No owner field exists on the sprint document (source is the literal "orchestrator", sprint.ts:164), so no owner check can be built. ESCALATE to ISO: writes gate on literal fleet.admin, or PR-L adds a creator-program field first.

### `sprint.completeSprintHandler:args.sprintId`

- Where: `modules/sprint.ts`, handler `completeSprintHandler`, expression `args.sprintId`, line n/a at base, 1 occurrence(s).
- Tool: sprint_complete_sprint; transports mcp, rest; effect write; decided by ISO; closes in PR-L.
- Binding today: none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164).
- Evidence: completeSprintHandler completes any sprint id; no owner comparison.
- Recommendation: No owner field exists on the sprint document (source is the literal "orchestrator", sprint.ts:164), so no owner check can be built. ESCALATE to ISO: writes gate on literal fleet.admin, or PR-L adds a creator-program field first.

### `sprint.getSprintHandler:args.sprintId`

- Where: `modules/sprint.ts`, handler `getSprintHandler`, expression `args.sprintId`, line n/a at base, 1 occurrence(s).
- Tool: sprint_get_sprint; transports mcp, rest, iso; effect read; decided by ISO; closes in PR-L.
- Binding today: none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164).
- Evidence: getSprintHandler returns any sprint by id; reachable on the ISO transport.
- Recommendation: No owner field exists on the sprint document (source is the literal "orchestrator", sprint.ts:164), so no owner check can be built. ESCALATE to ISO: reads gate on literal fleet.observe, or PR-L adds a creator-program field first.

### `signal.getResponseHandler:args.questionId`

- Where: `modules/signal.ts`, handler `getResponseHandler`, expression `args.questionId`, line n/a at base, 1 occurrence(s).
- Tool: signal_get_response; transports mcp, rest; effect read; decided by ISO; closes in PR-L.
- Binding today: none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body.
- Evidence: getResponseHandler returns the answer to any question id; no asker comparison.
- Recommendation: FOREIGN-READ gated on literal fleet.observe; SELF-ONLY on object ownership when unruled.

## ADDRESSED (5)

Each label claims no gate is needed, so ISO reviews each one individually.

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| dispatchHandler.sendTaskAndDirective:args.target | dispatch_dispatch | none on target; helper called by dispatchHandler | The argument names the recipient of a task and a directive. The sender is source-bound by verifySource (see the args.source record). |
| dispatchHandler.dispatchHandler:args.target | dispatch_dispatch | target must be a registered program, group or @role; no caller binding | dispatchHandler.ts:783 onward validates the target and creates a task, a directive and a wake for it. The target is the recipient. It also returns target state (heartbeat) to the caller. |
| tasks.createTaskHandler:args.target | dispatch_create_task | target must be a registered program, group or @role (tasks.ts:413-418) | The argument names the recipient of a new task. The sender is bound by verifySource. |
| relay.sendMessageHandler:args.target | relay_send_message | none by design; target resolved to program or group, unknown targets rejected (relay.ts:173-191) | The argument names the recipient. The sender is bound by verifySource at relay.ts:141. |
| relay.sendDirectiveHandler:parsed.target | relay_send_directive | delegates to sendMessageHandler | relay.ts:977-982 sends a DIRECTIVE through sendMessageHandler and reads the target's heartbeat state for a warning. The argument names the recipient. |

## ATTRIBUTION (9)

Each label claims no gate is needed, so ISO reviews each one individually.

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| index.main:params.callerSource | none | none; stored as caller_source and carried on a PROGRAM_WAKE event (wake/onDemandWake.ts:263, :286) | params.callerSource is passed to wakeTarget and written to the spawn record as caller_source (onDemandWake.ts:263, :286), which feeds a PROGRAM_WAKE event. It selects no document. |
| analytics.emitAnalyticsEvent:params.programId | none | none; label on an analytics event | Written to the analytics event as a label; it selects no document. Of 23 emitAnalyticsEvent call sites, 18 pass auth.programId (for example claims.ts:136, :345). 5 pass a caller-controlled value: verifiedSource at relay.ts:332, relay.ts:433, dispatch/tasks.ts:510 and dispatch/dispatchHandler.ts:373 (the exempt keys choose their source, gate.ts:164), and args.programId at pulse.ts:203. So the label is caller-controlled and must not be read as identity. |
| analytics.emitAnalyticsEvent:params.sessionId | none | none; label on an analytics event | Written to the analytics event as a label; it selects no document. claims.ts:137 and :344 pass args.sessionId, and verifiedSource is chosen by the caller for the exempt keys (gate.ts:164), so the value is caller-controlled and must not be read as identity. |
| programState.updateProgramStateHandler:args.sessionId | state_update_program_state | none; stored at programState.ts:535, :543 | args.sessionId is written onto the state document and the history row as a label. It selects no document. |
| rate-limits.logRateLimitEventHandler:args.sessionId | metrics_log_rate_limit_event | none; programId written is auth.programId (rate-limits.ts:78) | args.sessionId is stored on the event document. The program is taken from the credential. It selects nothing. |
| relay.sendMessageHandler:args.sessionId | relay_send_message | none; stored on the relay document (relay.ts:234) | relay.ts:234 stores sessionId on the message. relay.ts:369 passes it to logDirective. It selects no existing document. |
| signal.writeAlertDocs:input.sessionId | signal_send_alert | none; stored on alert (signal.ts:219) | Stored as a label on the alert document; selects nothing. |
| signal.sendAlertHandler:args.sessionId | signal_send_alert | none; stored on alert (signal.ts:279) | Passed into writeAlertDocs as a stored label; selects nothing. |
| rest.route POST /admin/reset-program-cache:body.programId | none | capabilities.includes("*") (rest.ts:942) | rest.ts:944 reads body.programId, writes it to an audit log line and echoes it. No cache exists (stateless). It selects nothing. |

## NOT-IDENTITY (5)

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| suggestion.suggestTargetHandler:p.programId | dispatch_suggest_target | n/a | suggestion.ts:87 is a map callback variable over ranked program rows, not a request argument. |
| patternConsolidation.consolidatePatternsHandler:p.programId | pattern_consolidate | n/a | patternConsolidation.ts:238 and :313 are loop variables over program documents, not request arguments (recon section 8). |
| programRegistry.listProgramsHandler:p.programId | programs_list_programs | n/a | programRegistry.ts:375 is a map callback variable over registry rows. |
| signal.writeAlertDocs:input.source | signal_send_alert | n/a: sendAlertHandler passes no source; the schedule executor passes a literal | sendAlertHandler passes no source (signal.ts:274-280), so the default "program" applies. schedule-executor.ts:199 and :208 pass the literal "watchdog". No caller-chosen value reaches input.source. |
| callback.isAllowedPrincipal:p.uid | none | n/a | p is the OAuth principal under test, compared to an env allowlist (callback.ts:48). The list gates OAuth sign-in, not a tool handler. |

## SELF-ONLY (9)

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| programState.storeMemoryHandler:args.programId | state_store_memory | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_store_memory is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.recallMemoryHandler:args.programId | state_recall_memory | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_recall_memory is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.memoryHealthHandler:args.programId | state_memory_health | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_memory_health is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.updateProgramStateHandler:args.programId | state_update_program_state | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_update_program_state is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.deleteMemoryHandler:args.programId | state_delete_memory | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_delete_memory is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.reinforceMemoryHandler:args.programId | state_reinforce_memory | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_reinforce_memory is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| programState.getContextHistoryHandler:args.programId | state_get_context_history | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self or mobile only; literal fleet.observe never admits a foreign caller. | PR-J: state_get_context_history is self-only plus mobile, bound to credentialPrincipal. The name lists STATE_READERS and STATE_WRITERS are deleted. A denial names the true principal. |
| relay.getSentMessagesHandler:args.target | relay_get_sent_messages | narrows a result already bound by source (relay.ts:628-629) | The filter intersects with source, which the args.source record owns. The target argument cannot widen the result. |
| gsp.gspSearchHandler:program_state-scan | gsp_search | credentialPrincipal(auth): scope memory reads only the caller's own program_state document; STATE_ADMIN_PRINCIPALS ["mobile"] keeps every document (C-5 rule 1). fleet.observe does not widen it (PR-J). | PR-J: the memory scan no longer lists the whole program_state collection. A foreign program's learnedPatterns are never returned through gsp_search. |

## FOREIGN-READ (2)

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| gsp.gspBootstrapHandler:args.agentId | gsp_bootstrap | authorizeGspBootstrapRead: credentialPrincipal, then literal fleet.observe for foreign reads (gsp.ts:648-661); memory omitted cross-program (:679) | Shipped in PR-3 of the predecessor plan. Operational state is served to a literal fleet.observe holder; memory is omitted when the subject is foreign. PR-I adds memory.status. |
| programState.getProgramStateHandler:args.programId | state_get_program_state | authorizeStateRead/authorizeStateWrite (programState.ts:119-159): credentialPrincipal(auth) first; STATE_ADMIN_PRINCIPALS ["mobile"] keeps full access (plan amendment 3, C-5 rule 1). Self and mobile read the full document; a foreign read needs literal fleet.observe and gets the document minus learnedPatterns and contextSummary with memory.status "omitted" (PR-J). | PR-J: the name lists STATE_READERS and STATE_WRITERS are deleted. A foreign fleet.observe read returns no memory and never writes (decay write-back runs only for self and mobile). Self and mobile reads return memory.status "loaded" or "empty". |

## FOREIGN-WRITE (1)

| Site | Tool | Binding today | Reason |
|---|---|---|---|
| keys.createKeyHandler:programId | keys_create_key | literal keys.provision via isKeyProvisioner (keys.ts:37; KEY_PROVISION_CAPABILITY, ownerAuthz.ts:51-53); a "*" key fails the literal includes and cannot mint | The real gate is the literal keys.provision capability (keys.ts:37, ownerAuthz.ts:51-53), not a name list and not fleet.admin. The handler mints a key for any programId. FOREIGN-WRITE in the vocabulary names fleet.admin as its widening capability, so this record is FOREIGN-WRITE with a different literal capability; the PR that closes it decides whether keys.provision is renamed or kept. createKey defaults capabilities to ["*"] at keys.ts:66 (amendment 2). |

## Sites the regexes cannot see

Four classes. Each is a record with `regex: none` and an anchor the test checks in the handler's source.

### 1. REST routes that query Firestore directly (rest.ts:321, 419, 436, 533, 603, 749)

| Site | Line at base | Disposition | Binding today |
|---|---|---|---|
| rest.route GET /v1/tasks/stats:getFirestore() | 325 | ESCALATE | requireAdmin: "*" or ADMIN_READERS (rest.ts:133-139, :323) |
| rest.route GET /v1/messages/unread:getFirestore() | 423 | ESCALATE | none |
| rest.route POST /v1/messages/mark_read:getFirestore() | 440 | ESCALATE | enforceBreaker on relay_mark_read (capability, wildcard-satisfiable); no ownership check (rest.ts:433-445) |
| rest.route GET /v1/sessions/history:getFirestore() | 537 | ESCALATE | requireAdmin (rest.ts:535) |
| rest.route GET /v1/sprints/active:getFirestore() | 607 | ESCALATE | requireAdmin (rest.ts:606) |
| rest.route GET /v1/gsp/proposals:getFirestore() | 753 | ESCALATE | none |

### 2. Calls that skip callTool (rest.ts:666, 707, 729, 859, and enrollHandler at 975)

| Site | Line at base | Disposition | Binding today |
|---|---|---|---|
| rest.route GET /v1/budget/summary:budgetSummaryHandler | 670 | ESCALATE | none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry |
| rest.route GET /v1/dreams:dreamPeekHandler | 711 | ESCALATE | none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry |
| rest.route GET /v1/gsp/namespaces:gspListNamespacesHandler | 733 | ESCALATE | none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry |
| rest.route GET /v1/dreams/peek:dreamPeekHandler | 863 | ESCALATE | none; the route skips callTool, so no capability gate, circuit breaker, rate limit or audit entry |
| rest.createRestRouter:enrollHandler | 980 | ESCALATE | none: public pre-auth route /enroll; identity comes from the enrollment token document (enrollment.ts:113, :178-179) |

### 3. Object-id handlers named in plan section 6

| Site | Line at base | Disposition | Binding today |
|---|---|---|---|
| interventions.abortTaskHandler:args.taskId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| interventions.escalateTaskHandler:args.taskId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| interventions.approveTaskHandler:args.taskId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| tasks.getTaskByIdHandler:args.taskId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| schedule.getScheduleHandler:args.scheduleId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| schedule.deleteScheduleHandler:args.scheduleId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| webhook.webhookDeleteHandler:args.webhookId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |
| policy.createPolicy:args.id | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| policy.updatePolicy:args.policyId | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| policy.deletePolicy:args.policyId | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| policy.getPolicy:args.policyId | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| policy.listPolicies:(tenant-wide) | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| policy.policyCheck:(tenant-wide) | n/a | ESCALATE | none; the stored creator is the tenant uid (policy.ts:208, :285), not a program |
| sprint.updateStoryHandler:args.sprintId | n/a | ESCALATE | none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164) |
| sprint.addStoryHandler:args.sprintId | n/a | ESCALATE | none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164) |
| sprint.completeSprintHandler:args.sprintId | n/a | ESCALATE | none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164) |
| sprint.getSprintHandler:args.sprintId | n/a | ESCALATE | none; the sprint task stores no creator (source is the literal "orchestrator", sprint.ts:164) |
| signal.getResponseHandler:args.questionId | n/a | ESCALATE | none found: no comparison of auth.programId, credentialPrincipal or a capability to the object's owner in the handler body |

### 4. Memory fan-out in gsp_search (gsp.ts:1897-1901)

| Site | Line at base | Disposition | Binding today |
|---|---|---|---|
| gsp.gspSearchHandler:program_state-scan | 1902 | SELF-ONLY | credentialPrincipal(auth): scope memory reads only the caller's own program_state document; STATE_ADMIN_PRINCIPALS ["mobile"] keeps every document (C-5 rule 1). fleet.observe does not widen it (PR-J). |

The AST rules also found a tenant-uid comparison outside the tool registry: `oauth/serviceAccounts.ts:100` (revokeServiceAccount). It is a baseline row, not a site record.

## All site records

| Site | Regex | Occ. | Line | Disposition | By | Closes in | Bundle |
|---|---|---|---|---|---|---|---|
| index.main:params.target | b | 2 | 631 | ESCALATE | ISO | ISO-assign | false |
| index.main:params.callerSource | b | 1 | 648 | ATTRIBUTION | ISO | n/a | false |
| ack-compliance.getAckComplianceHandler:args.programId | a | 3 | 112 | ESCALATE | ISO | PR-L | false |
| analytics.emitAnalyticsEvent:params.programId | b | 2 | 78 | ATTRIBUTION | ISO | n/a | false |
| analytics.emitAnalyticsEvent:params.sessionId | b | 2 | 79 | ATTRIBUTION | ISO | n/a | false |
| audit.getAuditHandler:args.programId | a | 2 | 46 | ESCALATE | C-5 | PR-L | false |
| clu.cluIngestHandler:parsed.session_id | b | 1 | 92 | ESCALATE | ISO | PR-L | false |
| clu.cluAnalyzeHandler:parsed.session_id | b | 3 | 137 | ESCALATE | ISO | PR-L | false |
| claims.claimTaskHandler:args.sessionId | a | 5 | 96 | ESCALATE | ISO | PR-K | false |
| claims.batchClaimTasksHandler:args.sessionId | a | 3 | 303 | ESCALATE | ISO | PR-K | false |
| dispatchHandler.sendTaskAndDirective:args.target | a | 7 | 234 | ADDRESSED | ISO | PR-K | false |
| dispatchHandler.dispatchHandler:args.source | a | 1 | 780 | ESCALATE | C-5 | PR-K | false |
| dispatchHandler.dispatchHandler:args.target | a | 40 | 783 | ADDRESSED | ISO | PR-K | false |
| interventions.retryTaskHandler:args.newTarget | b | 6 | 81 | ESCALATE | ISO | PR-L | false |
| interventions.reassignTaskHandler:args.newTarget | b | 7 | 283 | ESCALATE | ISO | PR-L | false |
| interventions.escalateTaskHandler:args.escalateTo | b | 4 | 395 | ESCALATE | C-5 | PR-L | false |
| interventions.quarantineProgramHandler:args.programId | a | 7 | 507 | ESCALATE | ISO | PR-L | false |
| interventions.unquarantineProgramHandler:args.programId | a | 7 | 571 | ESCALATE | ISO | PR-L | false |
| interventions.replayTaskHandler:args.newTarget | b | 7 | 639 | ESCALATE | ISO | PR-L | false |
| suggestion.suggestTargetHandler:p.programId | b | 1 | 87 | NOT-IDENTITY | ISO | n/a | false |
| tasks.getTasksHandler:args.target | a | 6 | 168 | ESCALATE | C-5 | PR-K | false |
| tasks.createTaskHandler:args.source | a | 1 | 428 | ESCALATE | C-5 | PR-K | false |
| tasks.createTaskHandler:args.target | a | 10 | 431 | ADDRESSED | ISO | PR-K | false |
| gsp.gspWriteHandler:args.source | a | 1 | 434 | ESCALATE | C-5 | PR-L | false |
| gsp.gspBootstrapHandler:args.agentId | a | 12 | 670 | FOREIGN-READ | C-4 | PR-I | false |
| keys.createKeyHandler:programId | c | 1 | 58 | FOREIGN-WRITE | ISO | n/a | false |
| keys.revokeKeyHandler:keyHash | c | 1 | 153 | ESCALATE | C-5 | PR-F | false |
| metrics.getProgramHealthHandler:args.programId | a | 3 | 862 | ESCALATE | C-5 | PR-L | false |
| patternConsolidation.consolidatePatternsHandler:p.programId | b | 2 | 238 | NOT-IDENTITY | ISO | n/a | false |
| programRegistry.listProgramsHandler:p.programId | b | 1 | 375 | NOT-IDENTITY | ISO | n/a | false |
| programRegistry.updateProgramHandler:args.programId | a | 7 | 392 | ESCALATE | C-5 | PR-L | false |
| programState.getProgramStateHandler:args.programId | a | 11 | 262 | FOREIGN-READ | C-4 | PR-J | false |
| programState.storeMemoryHandler:args.programId | a | 9 | 371 | SELF-ONLY | C-4 | PR-J | false |
| programState.recallMemoryHandler:args.programId | a | 10 | 433 | SELF-ONLY | C-4 | PR-J | false |
| programState.memoryHealthHandler:args.programId | a | 10 | 507 | SELF-ONLY | C-4 | PR-J | false |
| programState.updateProgramStateHandler:args.programId | a | 13 | 572 | SELF-ONLY | C-4 | PR-J | false |
| programState.updateProgramStateHandler:args.sessionId | a | 2 | 587 | ATTRIBUTION | ISO | n/a | false |
| programState.deleteMemoryHandler:args.programId | a | 9 | 727 | SELF-ONLY | C-4 | PR-J | false |
| programState.reinforceMemoryHandler:args.programId | a | 9 | 786 | SELF-ONLY | C-4 | PR-J | false |
| programState.getContextHistoryHandler:args.programId | a | 8 | 848 | SELF-ONLY | C-4 | PR-J | false |
| pulse.createSessionHandler:args.sessionId | a | 3 | 113 | ESCALATE | ISO | PR-L | false |
| pulse.createSessionHandler:args.programId | a | 1 | 122 | ESCALATE | C-5 | PR-L | false |
| pulse.updateSessionHandler:args.sessionId | a | 1 | 216 | ESCALATE | C-5 | PR-L | false |
| pulse.listSessionsHandler:args.programId | a | 1 | 747 | ESCALATE | ISO | PR-L | false |
| pulse.getContextUtilizationHandler:args.sessionId | a | 5 | 845 | ESCALATE | ISO | PR-L | false |
| pulse.pauseProgramHandler:args.programId | a | 9 | 951 | ESCALATE | ISO | PR-L | false |
| pulse.resumeProgramHandler:args.programId | a | 12 | 1021 | ESCALATE | ISO | PR-L | false |
| rate-limits.logRateLimitEventHandler:args.sessionId | a | 2 | 76 | ATTRIBUTION | ISO | n/a | false |
| rate-limits.getRateLimitEventsHandler:args.sessionId | a | 2 | 105 | ESCALATE | ISO | PR-L | false |
| relay.sendMessageHandler:args.target | a | 15 | 140 | ADDRESSED | ISO | PR-K | false |
| relay.sendMessageHandler:args.source | a | 3 | 142 | ESCALATE | C-5 | PR-K | false |
| relay.sendMessageHandler:args.sessionId | a | 2 | 241 | ATTRIBUTION | ISO | n/a | false |
| relay.getMessagesHandler:args.sessionId | a | 2 | 481 | ESCALATE | C-5 | PR-K | false |
| relay.getMessagesHandler:args.target | a | 2 | 481 | ESCALATE | C-5 | PR-K | false |
| relay.getSentMessagesHandler:args.source | a | 1 | 653 | ESCALATE | C-5 | PR-K | false |
| relay.getSentMessagesHandler:args.target | a | 2 | 669 | SELF-ONLY | ISO | n/a | false |
| relay.queryMessageHistoryHandler:args.source | a | 8 | 787 | ESCALATE | C-5 | PR-K | false |
| relay.queryMessageHistoryHandler:args.target | a | 9 | 787 | ESCALATE | C-5 | PR-K | false |
| relay.sendDirectiveHandler:parsed.target | b | 2 | 1018 | ADDRESSED | ISO | PR-K | false |
| schedule.createScheduleHandler:args.target | a | 2 | 128 | ESCALATE | ISO | PR-L | false |
| schedule.paginateAndFilter:args.target | a | 2 | 186 | ESCALATE | ISO | PR-L | false |
| schedule.listSchedulesHandler:args.target | a | 3 | 200 | ESCALATE | ISO | PR-L | false |
| schedule.updateScheduleHandler:args.target | a | 2 | 296 | ESCALATE | ISO | PR-L | false |
| signal.writeAlertDocs:input.source | b | 2 | 213 | NOT-IDENTITY | ISO | n/a | false |
| signal.writeAlertDocs:input.sessionId | b | 1 | 219 | ATTRIBUTION | ISO | n/a | false |
| signal.sendAlertHandler:args.sessionId | a | 1 | 279 | ATTRIBUTION | ISO | n/a | false |
| sprint.createSprintHandler:args.sessionId | a | 1 | 183 | ESCALATE | ISO | PR-K | false |
| trace.queryTracesHandler:args.programId | a | 2 | 218 | ESCALATE | C-5 | PR-L | false |
| onDemandWake.wakeTarget:userId,target,callerSource | c | 1 | 208 | ESCALATE | ISO | ISO-assign | false |
| callback.isAllowedPrincipal:p.uid | b | 1 | 48 | NOT-IDENTITY | ISO | n/a | false |
| CustomHTTPTransport.(module):parsed.sessionId | b | 9 | 130 | ESCALATE | ISO | ISO-assign | false |
| rest.route GET /v1/tasks/stats:query.target | a | 1 | 327 | ESCALATE | C-5 | PR-M | false |
| rest.route GET /v1/messages/unread:query.sessionId | a | 2 | 426 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/messages:query.sessionId | a | 1 | 453 | ESCALATE | C-5 | PR-K | false |
| rest.route GET /v1/program-state/:programId:p.programId | b | 1 | 790 | ESCALATE | C-5 | PR-J | false |
| rest.route PATCH /v1/program-state/:programId:p.programId | b | 1 | 795 | ESCALATE | C-5 | PR-J | false |
| rest.route GET /v1/program-state/:programId/context-history:p.programId | b | 1 | 800 | ESCALATE | C-5 | PR-J | false |
| rest.route POST /v1/memory/:programId/patterns:p.programId | b | 1 | 807 | ESCALATE | C-5 | PR-J | false |
| rest.route GET /v1/memory/:programId/patterns:p.programId | b | 1 | 812 | ESCALATE | C-5 | PR-J | false |
| rest.route DELETE /v1/memory/:programId/patterns/:patternId:p.programId | b | 1 | 816 | ESCALATE | C-5 | PR-J | false |
| rest.route PATCH /v1/memory/:programId/patterns/:patternId/reinforce:p.programId | b | 1 | 821 | ESCALATE | C-5 | PR-J | false |
| rest.route GET /v1/memory/:programId/health:p.programId | b | 1 | 825 | ESCALATE | C-5 | PR-J | false |
| rest.route GET /v1/interrupts/peek:query.sessionId | a | 1 | 859 | ESCALATE | C-5 | PR-K | false |
| rest.route POST /admin/reset-program-cache:body.programId | a | 1 | 944 | ATTRIBUTION | ISO | n/a | false |
| rest.route GET /v1/tasks/stats:getFirestore() | none | 1 | 325 | ESCALATE | C-5 | PR-M | false |
| rest.route GET /v1/messages/unread:getFirestore() | none | 1 | 423 | ESCALATE | ISO | PR-M | false |
| rest.route POST /v1/messages/mark_read:getFirestore() | none | 1 | 440 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/sessions/history:getFirestore() | none | 1 | 537 | ESCALATE | C-5 | PR-M | false |
| rest.route GET /v1/sprints/active:getFirestore() | none | 1 | 607 | ESCALATE | C-5 | PR-M | false |
| rest.route GET /v1/gsp/proposals:getFirestore() | none | 1 | 753 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/budget/summary:budgetSummaryHandler | none | 1 | 670 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/dreams:dreamPeekHandler | none | 1 | 711 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/gsp/namespaces:gspListNamespacesHandler | none | 1 | 733 | ESCALATE | ISO | PR-M | false |
| rest.route GET /v1/dreams/peek:dreamPeekHandler | none | 1 | 863 | ESCALATE | ISO | PR-M | false |
| rest.createRestRouter:enrollHandler | none | 1 | 980 | ESCALATE | ISO | PR-M | false |
| interventions.abortTaskHandler:args.taskId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| interventions.escalateTaskHandler:args.taskId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| interventions.approveTaskHandler:args.taskId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| tasks.getTaskByIdHandler:args.taskId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| schedule.getScheduleHandler:args.scheduleId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| schedule.deleteScheduleHandler:args.scheduleId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| webhook.webhookDeleteHandler:args.webhookId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.createPolicy:args.id | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.updatePolicy:args.policyId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.deletePolicy:args.policyId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.getPolicy:args.policyId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.listPolicies:(tenant-wide) | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| policy.policyCheck:(tenant-wide) | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| sprint.updateStoryHandler:args.sprintId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| sprint.addStoryHandler:args.sprintId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| sprint.completeSprintHandler:args.sprintId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| sprint.getSprintHandler:args.sprintId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| signal.getResponseHandler:args.questionId | none | 1 | n/a | ESCALATE | ISO | PR-L | false |
| gsp.gspSearchHandler:program_state-scan | none | 1 | 1902 | SELF-ONLY | C-4 | PR-J | false |

## Handler entries (R6)

| Tool | Handler | Transports | Effect | Sites | Name lists | serves_bundle_data |
|---|---|---|---|---|---|---|
| admin_merge_accounts | mergeAccountsHandler | mcp | write | 0 | 1 | false |
| audit_get_audit | getAuditHandler | mcp rest iso | read | 1 | 1 | false |
| audit_get_ack_compliance | getAckComplianceHandler | mcp rest | read | 1 | 0 | false |
| clu_ingest | cluIngestHandler | mcp | write | 1 | 0 | false |
| clu_analyze | cluAnalyzeHandler | mcp | read | 1 | 0 | false |
| clu_report | cluReportHandler | mcp | read | 0 | 0 | false |
| dispatch_get_tasks | getTasksHandler | mcp rest iso | read | 1 | 1 | false |
| dispatch_get_task_by_id | getTaskByIdHandler | mcp rest | read | 1 | 0 | false |
| dispatch_create_task | createTaskHandler | mcp rest iso | write | 2 | 1 | false |
| dispatch_claim_task | claimTaskHandler | mcp rest iso | write | 1 | 0 | false |
| dispatch_unclaim_task | unclaimTaskHandler | mcp rest | write | 0 | 1 | false |
| dispatch_complete_task | completeTaskHandler | mcp rest iso | write | 0 | 1 | false |
| dispatch_record_task_telemetry | recordTaskTelemetryHandler | mcp rest | write | 0 | 1 | false |
| dispatch_batch_claim_tasks | batchClaimTasksHandler | mcp rest | write | 1 | 0 | false |
| dispatch_batch_complete_tasks | batchCompleteTasksHandler | mcp rest | write | 0 | 1 | false |
| dispatch_get_contention_metrics | getContentionMetricsHandler | mcp rest | read | 0 | 0 | false |
| dispatch_dispatch | dispatchHandler | mcp rest | write | 3 | 1 | false |
| dispatch_retry_task | retryTaskHandler | mcp | write | 1 | 0 | false |
| dispatch_abort_task | abortTaskHandler | mcp | write | 1 | 0 | false |
| dispatch_reassign_task | reassignTaskHandler | mcp | write | 1 | 0 | false |
| dispatch_escalate_task | escalateTaskHandler | mcp | write | 2 | 1 | false |
| dispatch_quarantine_program | quarantineProgramHandler | mcp | write | 1 | 0 | false |
| dispatch_unquarantine_program | unquarantineProgramHandler | mcp | write | 1 | 0 | false |
| dispatch_replay_task | replayTaskHandler | mcp | write | 1 | 0 | false |
| dispatch_approve_task | approveTaskHandler | mcp | write | 1 | 0 | false |
| dispatch_get_task_lineage | getTaskLineageHandler | mcp | read | 0 | 0 | false |
| dispatch_export_tasks | exportTasksHandler | mcp | read | 0 | 0 | false |
| dispatch_suggest_target | suggestTargetHandler | mcp | read | 1 | 0 | false |
| dispatch_backfill_task_expires_at | backfillTaskExpiresAtHandler | mcp | write | 0 | 1 | false |
| dispatch_reap_expired_tasks | reapExpiredTasksHandler | mcp | write | 0 | 1 | false |
| dream_peek | dreamPeekHandler | mcp rest | read | 0 | 0 | false |
| dream_activate | dreamActivateHandler | mcp rest | write | 0 | 0 | false |
| feedback_submit_feedback | submitFeedbackHandler | mcp rest | write | 0 | 0 | false |
| gsp_read | gspReadHandler | mcp rest | read | 0 | 0 | false |
| gsp_write | gspWriteHandler | mcp rest | write | 1 | 1 | false |
| gsp_diff | gspDiffHandler | mcp | read | 0 | 0 | false |
| gsp_bootstrap | gspBootstrapHandler | mcp | read | 1 | 0 | false |
| gsp_seed | gspSeedHandler | mcp | write | 0 | 1 | false |
| gsp_propose | gspProposeHandler | mcp | write | 0 | 1 | false |
| gsp_subscribe | gspSubscribeHandler | mcp | write | 0 | 0 | false |
| gsp_resolve | gspResolveHandler | mcp rest | write | 0 | 0 | false |
| gsp_search | gspSearchHandler | mcp rest | read | 1 | 0 | false |
| keys_create_key | createKeyHandler | mcp rest | write | 1 | 0 | false |
| keys_revoke_key | revokeKeyHandler | mcp rest | write | 1 | 0 | false |
| keys_rotate_key | rotateKeyHandler | mcp rest | write | 0 | 0 | false |
| keys_list_keys | listKeysHandler | mcp rest iso | read | 0 | 0 | false |
| metrics_get_cost_summary | getCostSummaryHandler | mcp rest iso | read | 0 | 1 | false |
| metrics_get_comms_metrics | getCommsMetricsHandler | mcp rest iso | read | 0 | 1 | false |
| metrics_get_operational_metrics | getOperationalMetricsHandler | mcp rest iso | read | 0 | 1 | false |
| metrics_log_rate_limit_event | logRateLimitEventHandler | mcp rest | write | 1 | 0 | false |
| metrics_get_rate_limit_events | getRateLimitEventsHandler | mcp rest | read | 1 | 0 | false |
| metrics_get_cost_forecast | getCostForecastHandler | mcp | read | 0 | 1 | false |
| metrics_get_sla_compliance | getSlaComplianceHandler | mcp | read | 0 | 1 | false |
| metrics_get_program_health | getProgramHealthHandler | mcp | read | 1 | 1 | false |
| pattern_consolidate | consolidatePatternsHandler | mcp | write | 1 | 0 | false |
| pattern_get_consolidated | getConsolidatedPatternsHandler | mcp | read | 0 | 0 | false |
| policy_create | createPolicy | mcp | write | 1 | 0 | false |
| policy_update | updatePolicy | mcp | write | 1 | 0 | false |
| policy_delete | deletePolicy | mcp | write | 1 | 0 | false |
| policy_get | getPolicy | mcp | read | 1 | 0 | false |
| policy_list | listPolicies | mcp | read | 1 | 0 | false |
| policy_check | policyCheck | mcp | read | 1 | 0 | false |
| state_get_program_state | getProgramStateHandler | mcp rest | read | 2 | 0 | false |
| state_update_program_state | updateProgramStateHandler | mcp rest | write | 3 | 0 | false |
| state_get_context_history | getContextHistoryHandler | mcp rest | read | 2 | 0 | false |
| state_store_memory | storeMemoryHandler | mcp rest | write | 2 | 0 | false |
| state_recall_memory | recallMemoryHandler | mcp rest | read | 2 | 0 | false |
| state_memory_health | memoryHealthHandler | mcp rest | read | 2 | 0 | false |
| state_delete_memory | deleteMemoryHandler | mcp rest | write | 2 | 0 | false |
| state_reinforce_memory | reinforceMemoryHandler | mcp rest | write | 2 | 0 | false |
| programs_list_programs | listProgramsHandler | mcp | read | 1 | 0 | false |
| programs_update_program | updateProgramHandler | mcp | write | 1 | 1 | false |
| pulse_create_session | createSessionHandler | mcp rest | write | 2 | 1 | false |
| pulse_update_session | updateSessionHandler | mcp rest iso | write | 1 | 2 | false |
| pulse_list_sessions | listSessionsHandler | mcp rest | read | 1 | 0 | false |
| pulse_get_fleet_health | getFleetHealthHandler | mcp rest iso | read | 0 | 1 | false |
| pulse_get_fleet_timeline | getFleetTimelineHandler | mcp rest | read | 0 | 0 | false |
| pulse_write_fleet_snapshot | writeFleetSnapshotHandler | mcp rest | write | 0 | 0 | false |
| pulse_get_context_utilization | getContextUtilizationHandler | mcp rest | read | 1 | 0 | false |
| pulse_pause_program | pauseProgramHandler | mcp | write | 1 | 0 | false |
| pulse_resume_program | resumeProgramHandler | mcp | write | 1 | 0 | false |
| relay_send_message | sendMessageHandler | mcp rest iso | write | 3 | 1 | false |
| relay_get_messages | getMessagesHandler | mcp rest iso | mixed | 4 | 1 | false |
| relay_get_dead_letters | getDeadLettersHandler | mcp rest iso | read | 0 | 1 | false |
| relay_list_groups | listGroupsHandler | mcp rest | read | 0 | 0 | false |
| relay_get_sent_messages | getSentMessagesHandler | mcp rest iso | read | 2 | 1 | false |
| relay_query_message_history | queryMessageHistoryHandler | mcp rest iso | read | 2 | 1 | false |
| relay_send_directive | sendDirectiveHandler | mcp | write | 1 | 1 | false |
| request_help (lite) | requestHelpHandler | mcp | write | 0 | 0 | false |
| schedule_create | createScheduleHandler | mcp | write | 1 | 0 | false |
| schedule_list | listSchedulesHandler | mcp | read | 2 | 0 | false |
| schedule_get | getScheduleHandler | mcp | read | 1 | 0 | false |
| schedule_update | updateScheduleHandler | mcp | write | 1 | 0 | false |
| schedule_delete | deleteScheduleHandler | mcp | write | 1 | 0 | false |
| signal_ask_question | askQuestionHandler | mcp rest | write | 0 | 0 | false |
| signal_get_response | getResponseHandler | mcp rest | read | 1 | 0 | false |
| signal_send_alert | sendAlertHandler | mcp rest iso | write | 3 | 0 | false |
| sprint_create_sprint | createSprintHandler | mcp rest | write | 1 | 0 | false |
| sprint_update_sprint_story | updateStoryHandler | mcp rest | write | 1 | 0 | false |
| sprint_add_story_to_sprint | addStoryHandler | mcp rest | write | 1 | 0 | false |
| sprint_complete_sprint | completeSprintHandler | mcp rest | write | 1 | 0 | false |
| sprint_get_sprint | getSprintHandler | mcp rest iso | read | 1 | 0 | false |
| trace_query_traces | queryTracesHandler | mcp rest iso | read | 1 | 1 | false |
| trace_query_trace | queryTraceHandler | mcp rest | read | 0 | 1 | false |
| usage_get_usage | getUsageHandler | mcp rest | read | 0 | 0 | false |
| usage_get_invoice | getInvoiceHandler | mcp rest | read | 0 | 0 | false |
| usage_set_budget | setBudgetHandler | mcp rest | write | 0 | 0 | false |
| webhook_register | webhookRegisterHandler | mcp | write | 0 | 0 | false |
| webhook_list | webhookListHandler | mcp | read | 0 | 0 | false |
| webhook_delete | webhookDeleteHandler | mcp | write | 1 | 0 | false |
| webhook_get_deliveries | webhookGetDeliveriesHandler | mcp | read | 0 | 0 | false |

Lite-profile entries (not in the 110): request_help.

### Bundle greps

```
git grep -n -i -P 'brain[ _-]?bundle|brainBundle|bundle' -- . ':!*package-lock.json' ':!apps/mobile'
CONTRIBUTING.md:104:- **Is it focused?** One PR, one change. Don't bundle unrelated modifications.
apps/web/tsconfig.json:15:    "moduleResolution": "bundler",
docs/deployment.md:346:flutter build appbundle --release
```

Result: 3 hits, none a bundle store.

```
git grep -i -c -P '\bbrain\b'
services/mcp-server/src/modules/relay.ts:1
```

Result: 1 file; the hit is the comment 'split-brain' at relay.ts:22.

```
git grep -n -i -P 'getStorage|\.bucket\(|gs://|storageBucket' -- services
services/functions/public/cli-auth.html:136:      storageBucket: "cachebash-app.firebasestorage.app",
```

Result: 1 hit, a Firebase web config; no server-side object storage.

### Handlers storing caller-keyed tenant data (10)

Not an ADR-015 brain bundle (PDR 4.4, R6). Caller-chosen namespace/key select a document inside tenants/{auth.userId}; the tenant segment derives from the credential and no argument selects it, so R6 property holds even under the literal reading. Ruled by ISO 2026-11-20 (HpgeGWU8), upheld by VECTOR (kCAh8BiR).

| Tool | Tenant segment built at | Note |
|---|---|---|
| gsp_read | modules/gsp.ts:165 | ruled by ISO, upheld by VECTOR |
| gsp_write | modules/gsp.ts:437 | ruled by ISO, upheld by VECTOR |
| gsp_diff | modules/gsp.ts:499 | ruled by ISO, upheld by VECTOR |
| gsp_bootstrap | modules/gsp.ts:760 | ruled by ISO, upheld by VECTOR |
| gsp_seed | modules/gsp.ts:1228 | ruled by ISO, upheld by VECTOR |
| gsp_propose | modules/gsp.ts:1339; modules/gsp.ts:1377 | ruled by ISO, upheld by VECTOR |
| gsp_subscribe | modules/gsp.ts:231; modules/gsp.ts:261 | Added by the builder beyond the ISO list: VECTOR cited gsp.ts:230 and :259, which belong to gsp_subscribe, and subscriptions are keyed by caller-chosen namespace and key. ISO may strike it. |
| gsp_resolve | modules/gsp.ts:1617; modules/gsp.ts:1693 | ruled by ISO, upheld by VECTOR |
| gsp_search | modules/gsp.ts:1820 | ruled by ISO, upheld by VECTOR |
| state_update_program_state | modules/programState.ts:583 | ruled by ISO, upheld by VECTOR |

The shared path builder is gspCollectionPath at gsp.ts:66-67, which takes the tenant from its caller. gspListNamespacesHandler builds its own tenant segment at gsp.ts:123-124 (REST direct call, see the invisible-class table).

Probe T6.gsp_read (src/__tests__/probes/t6.probe.ts) asserts the property at runtime: tenant B reads tenant A's namespace and key and gets found:false, and tenant A reads its own row.

Namespace and key authority inside the tenant is an authorization question and has its own site records (for example gsp_write source, gsp_search memory scan).

## C-5 table: hardcoded name lists

Columns 1 and 2 come from code. Column 3 is ISO's 30-day audit-ledger measurement (source: `grid/specs/EVIDENCE-rd5-c5-usage.md` in rezzedai/grid, merged f98406ff). The ledger records only calls through callTool. The dispatcher, legacy and mobile show 0 rows because the direct REST routes write no ledger row, so a zero does not show a principal never calls the path. programId is auth.programId, mutable while the override path exists (PR-H). Counts are even, so compare ratios. VECTOR rules per identity in grid plan amendment 3; no name list changes here. No list is deleted before VECTOR rules per identity.

| Name list (file:line, members) | Handlers it guards | Principals that called it in the last 30 days |
|---|---|---|
| NL-ADMIN-READERS `config/access-tiers.ts:6` [admin, legacy, mobile, orchestrator, vector, iso] (rest) | route GET /v1/tasks/stats, route GET /v1/sessions, route GET /v1/sessions/history, route GET /v1/sprints/active | not measured (no tool_call rows exist for this path) |
| NL-ADMIN-PROGRAMS `middleware/gate.ts:133` [legacy, mobile, orchestrator, admin, dispatcher] (handler) | audit_get_audit, metrics_get_comms_metrics, metrics_get_cost_summary, metrics_get_operational_metrics, metrics_get_cost_forecast, metrics_get_sla_compliance, metrics_get_program_health, pulse_get_fleet_health, relay_get_sent_messages, relay_get_dead_letters, relay_query_message_history, trace_query_trace, trace_query_traces, dispatch_record_task_telemetry | members seen: none; non-members: iso 1648, vector 1606, tensor 12, basher 8, vector_datatrue 2 |
| NL-VERIFYSOURCE-ADMIN `middleware/gate.ts:148` [mobile] (handler) | relay_send_message, dispatch_create_task, dispatch_dispatch, gsp_write, relay_send_directive | members seen: none; non-members: iso 1280, vector 658, basher 194, tensor 182, vector_datatrue 116 |
| NL-CLAIM-OWNER-OVERRIDE `modules/dispatch/shared.ts:110` [iso, dispatcher] (handler) | dispatch_unclaim_task, dispatch_complete_task, dispatch_batch_complete_tasks | members seen: iso 588; non-members: basher 408, vector 208, vector_datatrue 26 |
| NL-ESCALATION-CHAIN `modules/dispatch/interventions.ts:374` [iso, orchestrator, vector, dispatcher, legacy] (routing) | dispatch_escalate_task | members seen: none |
| NL-GETTASKS-DEFAULT `modules/dispatch/tasks.ts:137` [mobile, dispatcher] (handler) | dispatch_get_tasks | members seen: none; non-members: iso 928, vector 386, basher 64, vector_datatrue 36, tensor 10 |
| NL-REGISTRY-ADMIN `modules/programRegistry.ts:400` [legacy, mobile, orchestrator, iso, vector, dispatcher] (handler) | programs_update_program | members seen: none |
| NL-PULSE-PRIV `modules/pulse.ts:87` [mobile, dispatcher] (handler) | pulse_create_session, pulse_update_session, pulse_list_sessions, pulse_get_context_utilization | members seen: none; non-members: iso 356, basher 146, vector 118, vector_datatrue 2, sark 2 |
| NL-PULSE-REGISTRY-SKIP `modules/pulse.ts:89` [mobile] (routing) | pulse_create_session, pulse_update_session | members seen: none; non-members: iso 356, basher 146, vector 118, tensor 2, vector_datatrue 2, sark 2 |
| NL-RELAY-GETMSG `modules/relay.ts:84` [mobile, dispatcher] (handler) | relay_get_messages | members seen: none; non-members: iso 772, vector_datatrue 244, vector 64, tensor 46, basher 38 |
| NL-ACCOUNT-MERGE `modules/account-merge.ts:26` [legacy] (handler) | admin_merge_accounts | members seen: none |
| NL-BACKFILL-AUTH `modules/dispatch/backfillExpiresAt.ts:44` [basher, iso, vector] (handler) | dispatch_backfill_task_expires_at | members seen: none |
| NL-REAP-AUTH `modules/dispatch/reapExpiredTasks.ts:99` [basher, iso, vector] (handler) | dispatch_reap_expired_tasks | members seen: none |
| NL-GSP-SEED-AUTH `modules/gsp.ts:1215` [vector, iso, admin, dispatcher, gsp-sync] (handler) | gsp_seed | members seen: gsp-sync 56 |
| NL-REST-RELAY-MOBILE `transport/rest.ts:476` [mobile] (rest) | route POST /v1/relay/messages | not measured (no tool_call rows exist for this path) |
| NL-SESSION-COMPLIANCE `middleware/sessionCompliance.ts:42` [legacy, mobile, admin, admin-mirror, bit, orchestrator, iso, alan, vector, quorra, radia, casp, sark, builder, basher, able, beck] (middleware) | every tool via checkSessionCompliance (MCP and REST) | not measured (no tool_call rows exist for this path) |
| NL-GSP-REVIEWERS `modules/gsp.ts:617` [iso, vector] (routing) | gsp_propose | members seen: none |
| NL-OAUTH-ALLOWLIST `oauth/callback.ts:48` [env-driven] (auth) | (OAuth sign-in; no tool handler) | not measured (no tool_call rows exist for this path) |
| NL-OAUTH-BINDABLE `auth/oauthTokenValidator.ts:54` [scalar, oauth, oauth-service] (auth) | (OAuth token validation; no tool handler) | not measured (no tool_call rows exist for this path) |
| NL-FIREBASE-MOBILE `auth/firebaseAuthValidator.ts:58` [mobile] (auth) | (Firebase ID-token auth; no tool handler) | not measured (no tool_call rows exist for this path) |
| NL-RELAY-ADMIN `modules/relay.ts:86` [mobile, dispatcher] (handler) | relay_get_sent_messages, relay_query_message_history | not measured: new list in PR-K. Members carry over from NL-ADMIN-PROGRAMS (legacy, orchestrator and admin dropped by amendment 3). |

### Name list notes

- NL-ADMIN-READERS: requireAdmin also passes any key holding "*".
- NL-ADMIN-PROGRAMS: isAdmin; several of these also pass on a wildcard-satisfiable capability (metrics.read, audit.read, fleet.read).
- NL-VERIFYSOURCE-ADMIN: mobile may send as any source. legacy was dropped in PR-K (amendment 3).
- NL-CLAIM-OWNER-OVERRIDE: iso and dispatcher unclaim and complete any task. orchestrator and legacy were dropped in PR-K (K-D1).
- NL-ESCALATION-CHAIN: Picks the default escalation recipient. It gates nothing.
- NL-GETTASKS-DEFAULT: mobile and dispatcher read every task with no target and any named target (K-D4). legacy was dropped in PR-K.
- NL-REGISTRY-ADMIN: These names may edit any program entry.
- NL-PULSE-PRIV: These principals create, update and read any program's session. legacy was dropped in PR-L; an empty principal is never a member.
- NL-PULSE-REGISTRY-SKIP: Skips the program-registry write for session owners in this list. It gates nothing. legacy was dropped in PR-L (L-D11).
- NL-RELAY-GETMSG: mobile and dispatcher read the requested target. legacy was dropped in PR-K.
- NL-ACCOUNT-MERGE: Only this name may merge accounts.
- NL-BACKFILL-AUTH: Also passes on "*".
- NL-REAP-AUTH: Also passes on "*".
- NL-GSP-SEED-AUTH: Also passes on "*".
- NL-REST-RELAY-MOBILE: Branches the source on the mobile name before credentialPrincipal.
- NL-SESSION-COMPLIANCE: Exempts or classifies callers for the session-boot rule. It is not an identity gate on data.
- NL-GSP-REVIEWERS: Chooses proposal reviewers. It gates nothing.
- NL-OAUTH-ALLOWLIST: Read from OAUTH_ALLOWED_UIDS; the default list is in the same file.
- NL-OAUTH-BINDABLE: Programs an OAuth token may bind to.
- NL-FIREBASE-MOBILE: A Firebase user without a program mapping authenticates as mobile.
- NL-RELAY-ADMIN: mobile and dispatcher read any source or participant (K-D3 option 1). Replaces isAdmin at these two sites; gate.ts ADMIN_PROGRAMS is unchanged (PR-L).

## D-f AST baseline (pending)

| Rule | Rows | Occurrences |
|---|---|---|
| S1 | 39 | 148 |
| S2 | 1 | 1 |
| S3 | 4 | 4 |

The test fails on a violation with no row and on a row that no longer matches. The baseline only shrinks.

| Rule | File | Handler | Expression | Occ. | Line at base |
|---|---|---|---|---|---|
| S1 | index.ts | main | `auth.programId` | 17 | 182 |
| S1 | iso/isoServer.ts | createIsoServer | `authContext.programId` | 12 | 105 |
| S1 | middleware/gate.ts | isAdmin | `auth.programId` | 1 | 136 |
| S1 | middleware/sessionCompliance.ts | checkSessionCompliance | `auth.programId` | 11 | 108 |
| S1 | modules/account-merge.ts | mergeAccountsHandler | `auth.programId` | 1 | 26 |
| S1 | modules/dispatch/backfillExpiresAt.ts | backfillTaskExpiresAtHandler | `auth.programId` | 2 | 63 |
| S1 | modules/dispatch/claims.ts | claimTaskHandler | `auth.programId` | 5 | 90 |
| S1 | modules/dispatch/claims.ts | unclaimTaskHandler | `auth.programId` | 3 | 198 |
| S1 | modules/dispatch/claims.ts | batchClaimTasksHandler | `auth.programId` | 3 | 297 |
| S1 | modules/dispatch/completion.ts | completeTaskHandler | `auth.programId` | 9 | 511 |
| S1 | modules/dispatch/completion.ts | batchCompleteTasksHandler | `auth.programId` | 6 | 845 |
| S1 | modules/dispatch/completion.ts | recordTaskTelemetryHandler | `auth.programId` | 1 | 1026 |
| S1 | modules/dispatch/interventions.ts | retryTaskHandler | `auth.programId` | 3 | 107 |
| S1 | modules/dispatch/interventions.ts | abortTaskHandler | `auth.programId` | 5 | 215 |
| S1 | modules/dispatch/interventions.ts | reassignTaskHandler | `auth.programId` | 4 | 302 |
| S1 | modules/dispatch/interventions.ts | escalateTaskHandler | `auth.programId` | 4 | 419 |
| S1 | modules/dispatch/interventions.ts | quarantineProgramHandler | `auth.programId` | 3 | 524 |
| S1 | modules/dispatch/interventions.ts | unquarantineProgramHandler | `auth.programId` | 3 | 590 |
| S1 | modules/dispatch/interventions.ts | replayTaskHandler | `auth.programId` | 2 | 718 |
| S1 | modules/dispatch/interventions.ts | approveTaskHandler | `auth.programId` | 4 | 781 |
| S1 | modules/dispatch/reapExpiredTasks.ts | reapExpiredTasksHandler | `auth.programId` | 2 | 221 |
| S1 | modules/gsp.ts | gspSeedHandler | `auth.programId` | 3 | 1218 |
| S1 | modules/gsp.ts | gspProposeHandler | `auth.programId` | 7 | 1379 |
| S1 | modules/gsp.ts | gspSubscribeHandler | `auth.programId` | 1 | 1502 |
| S1 | modules/gsp.ts | gspResolveHandler | `auth.programId` | 8 | 1664 |
| S1 | modules/keys.ts | createKeyHandler | `auth.programId` | 1 | 106 |
| S1 | modules/programRegistry.ts | updateProgramHandler | `auth.programId` | 3 | 400 |
| S1 | modules/rate-limits.ts | logRateLimitEventHandler | `auth.programId` | 1 | 77 |
| S1 | modules/relay.ts | sendMessageHandler | `auth.programId` | 1 | 119 |
| S1 | modules/schedule.ts | createScheduleHandler | `auth.programId` | 1 | 141 |
| S1 | modules/sprint.ts | createSprintHandler | `auth.programId` | 1 | 251 |
| S1 | modules/sprint.ts | updateStoryHandler | `auth.programId` | 2 | 331 |
| S1 | modules/sprint.ts | completeSprintHandler | `auth.programId` | 1 | 456 |
| S1 | modules/webhook.ts | webhookRegisterHandler | `auth.programId` | 1 | 130 |
| S1 | transport/rest.ts | requireAdmin | `auth.programId` | 1 | 134 |
| S1 | transport/rest.ts | callTool | `auth.programId` | 11 | 192 |
| S1 | transport/rest.ts | enforceBreaker | `auth.programId` | 2 | 314 |
| S1 | transport/rest.ts | route POST /v1/relay/messages | `auth.programId` | 1 | 476 |
| S1 | transport/rest.ts | route POST /admin/reset-program-cache | `auth.programId` | 1 | 955 |
| S2 | oauth/serviceAccounts.ts | revokeServiceAccount | `auth.userId` | 1 | 100 |
| S3 | modules/programRegistry.ts | updateProgramHandler | `args.programId` | 1 | 401 |
| S3 | modules/relay.ts | queryMessageHistoryHandler | `args.source` | 1 | 802 |
| S3 | modules/relay.ts | queryMessageHistoryHandler | `args.target` | 1 | 809 |
| S3 | modules/schedule.ts | paginateAndFilter | `args.target` | 1 | 186 |
