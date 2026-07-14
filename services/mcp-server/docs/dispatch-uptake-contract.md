# Dispatch Uptake Contract

`dispatch_dispatch` is the canonical API for actionable work dispatch. It creates or reuses a durable dispatch obligation, task, and DIRECTIVE relay message before runtime assessment or wake, then waits for target uptake when requested.

`relay_send_message` remains asynchronous. A successful relay send only means the message was stored for delivery; it does not prove a target accepted work.

## Invariant

Actionable dispatch must never report `success: true` until one of these is observed:

- the task leaves `created` and is claimed by the target program
- the intended target sends an `ACK` whose `reply_to` is the dispatch DIRECTIVE id and whose recipient is the dispatch source

If uptake is not observed, the API returns `success: false` with `pendingHandle`. Supervisors should track `pendingHandle.obligationId` instead of redispatching blindly.

The server also maintains an internal caller-boundary deadline below the observed MCP proxy timeout. If wake/preflight work consumes that budget before claim SLA elapses, `dispatch_dispatch` returns `success: false` with the durable `pendingHandle` and `pendingReason: "caller_boundary_deadline"` rather than waiting for the outer transport to time out. The default internal boundary is 45 seconds, leaving response margin under the observed 55-second MCP proxy boundary.

## Durable Records

Each dispatch writes `tenants/{tenant}/dispatch_obligations/{obligationId}` with:

- `taskId`, `directiveId`, `source`, `target`, `threadId`
- `deliveryState`
- `claimSlaSeconds`, `claimDeadlineAt`
- wake result and target-state metadata
- telemetry such as `timeToClaimMs`, `timeToAckMs`, and `escalatedAt`

The task also stores `dispatchObligationId` and `dispatchDeliveryState` for quick inspection.

Runtime preflight and wake metadata are annotations on the existing obligation. A preflight or wake failure must not erase the persisted obligation/task/directive handle.

## Delivery States

- `stored`: obligation exists and queued work is durable
- `wake-attempted`: server attempted host wake/relaunch
- `notified`: DIRECTIVE relay was stored
- `claimed`: target claimed the task or ACKed the DIRECTIVE
- `rejected`: policy/runtime state means target cannot accept work, such as paused or quarantined
- `escalated`: claim SLA elapsed without claim or ACK
- `expired`: reserved for TTL cleanup

## Idempotency

Callers may pass `idempotency_key`. Reusing the key returns the existing obligation/task/directive instead of creating duplicate work. Use this for retries after client timeouts.

## Operating Guidance

For absent or stale targets, keep `autoWake: true`. The server may wake or launch the target through the wake host, but senders must not inject into another program's attended terminal. Dispatch wake triggers launch without waiting for heartbeat confirmation; uptake is proven by task claim or DIRECTIVE ACK.

For busy targets, work remains queued as a task. A claim-SLA timeout from `dispatch_dispatch` is not a lost dispatch; it is an escalated pending obligation. A caller-boundary timeout is not a claim-SLA miss and remains a monitored pending obligation.

For `waitForUptake: false`, the response is intentionally not successful. It returns a tracked pending handle and `action_required: "monitor_pending"`.

Skipping the uptake wait does not downgrade a `notified` obligation back to `stored`; delivery-state transitions are monotonic.
