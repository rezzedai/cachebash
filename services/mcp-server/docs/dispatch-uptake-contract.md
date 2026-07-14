# Dispatch Uptake Contract

`dispatch_dispatch` is the canonical API for actionable work dispatch. It creates a durable dispatch obligation, task, and DIRECTIVE relay message together, then waits for target uptake when requested.

`relay_send_message` remains asynchronous. A successful relay send only means the message was stored for delivery; it does not prove a target accepted work.

## Invariant

Actionable dispatch must never report `success: true` until one of these is observed:

- the task leaves `created` and is claimed by the target program
- the target sends an `ACK` whose `reply_to` is the dispatch DIRECTIVE id

If uptake is not observed, the API returns `success: false` with `pendingHandle`. Supervisors should track `pendingHandle.obligationId` instead of redispatching blindly.

## Durable Records

Each dispatch writes `tenants/{tenant}/dispatch_obligations/{obligationId}` with:

- `taskId`, `directiveId`, `source`, `target`, `threadId`
- `deliveryState`
- `claimSlaSeconds`, `claimDeadlineAt`
- wake result and target-state metadata
- telemetry such as `timeToClaimMs`, `timeToAckMs`, and `escalatedAt`

The task also stores `dispatchObligationId` and `dispatchDeliveryState` for quick inspection.

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

For absent or stale targets, keep `autoWake: true`. The server may wake or launch the target through the wake host, but senders must not inject into another program's attended terminal.

For busy targets, work remains queued as a task. A timeout from `dispatch_dispatch` is not a lost dispatch; it is an escalated pending obligation.

For `waitForUptake: false`, the response is intentionally not successful. It returns a tracked pending handle and `action_required: "monitor_pending"`.
