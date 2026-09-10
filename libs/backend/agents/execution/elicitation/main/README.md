# @opencrane/backend/agents/execution/elicitation — participant input authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › elicitation

## What it owns

This package owns every recoverable question that pauses an agent run for one selected participant.
It gives approvals, choices, bounded text, memory permission, and reviewed A2UI actions one durable
lifecycle while keeping the purpose-specific consequence behind a server-owned strategy.

```
 runtime proposal -> server selects participant -> elicitation  ◄── HERE
                                                    │ answer / decline / expiry
                                                    ▼
                                     purpose strategy + one runtime resume
```

**In this flow:** [protocol](../../protocol/README.md) · [runs](../../runs/main/README.md)

The invariant is that one exact participant may resolve one run-, attempt-, conversation-, and
request-bound ask once. A stale run, ended participant, missing step-up, duplicate conflict, or
expired deadline fails closed. Personal-memory permission pauses the exact `memory:recall`
invocation for its execution user, then binds the accepted receipt to that invocation revision,
run attempt, query digest, frozen input snapshot, persona revision, and expiry. A parent or another
group participant cannot answer in the execution user's place. Fact content never passes through
the generic elicitation result.

## Public surface

- `PrismaElicitationUnitOfWork` — starts serializable transactions for browser responses, request
  reads, and personal-memory permission checks.
- `PrismaRuntimeElicitationUnitOfWork` — opens runtime proposals and expires due requests on the
  dispatch transaction that already holds the run lock; it never nests another transaction.
- `PersonalMemoryPermissionAuthority` — opens and verifies the exact execution-user receipt without reading or consuming remembered content.
- `_CreateElicitationInterruptReader` — generic cursorless reconnect overlay for every body type.
- `_CreateSelfElicitationActivityRouter` — bounded derived Activity references over canonical requests.

## Boundary

The package owns request, response-attempt, result-delivery, and one-use memory-permission records.
Tool approval keeps its own audit row, and runtime, browser, and A2UI payloads cannot select the
respondent, dataset, or protected action.

For a personal approval, the assigned participant answers the server-issued request. IAM changes
the invocation to ready or failed inside that response transaction, and an injected wake port emits
the existing saved-turn event only after the final pending input is gone. The wake port belongs to
conversation composition, so this package does not create a scheduler or dispatch a tool.

Runtime protocol code passes its existing transaction into `PrismaRuntimeElicitationUnitOfWork`.
That unit constructs one repository from the same transaction and reuses it for the callback. This
keeps the run lock, request change, candidate acceptance, and expiry decision in one commit without
letting a generic function carry a Prisma client across the boundary.

The personal-memory payload module builds the permission request and compares it with a saved
receipt. The personal-memory purpose supplies the live invocation, snapshot and receipt; neither
module opens a transaction or reads remembered facts.

The request repository owns attribution, response retries, request state and run resumption. Each
purpose has a transaction-bound implementation under `src/purposes/`: `runtime-input/` writes ordinary
answers, `tool-approval/` delegates decisions to IAM, `personal-memory/` checks and writes permission
receipts, and `a2ui-action/` binds a response to the displayed action. They never open a transaction
or call back into private request-repository methods.

Purpose and lifecycle are separate decisions. The request repository applies these existing rules
before and after calling the selected purpose implementation:

| Current state and event | Guard and result | Atomic owner |
| --- | --- | --- |
| Running run receives a new question | Same run attempt and current participant access; pause as WaitingForInput and save the request. | Request repository |
| Requested request receives a valid response | Assigned participant, current access, required step-up and central permission; record the response and mark Answered or Declined. | Request repository |
| Resolved request receives the same response key and digest | Return the saved resolution without applying its purpose twice. A changed digest conflicts. | Request repository |
| Resolved request receives a new response key | Return a conflict without changing the request. | Request repository |
| Requested request reaches its deadline | Apply purpose expiry, then mark Expired. | Request repository and selected purpose |
| WaitingForInput run finishes a response or expiry | Resume only when both requested-input and pending-approval counts are zero. | Request repository |
| A conditional request/run write loses, or a purpose refuses after a response write | Throw so the whole transaction rolls back. | Enclosing Serializable unit of work |

These changes do not introduce another lifecycle planner. Tool-invocation transitions continue to
belong to IAM; purpose implementations cannot claim or dispatch a provider request.

## Dependency direction

Tagged `scope:execution-elicitation` in the backend layer. It may depend on execution-run,
conversation, authorization, authentication, agent-model, utility, and shared contracts, never apps.

## Data & persistence

`elicitation.prisma` owns requests, response attempts, runtime result deliveries, and one-use
personal-memory permission receipts. The clean baseline enforces exact
coordinates, terminal finality, and one accepted response.

Ordinary input answers are delivered to the exact runtime attempt once. Protected tool, memory, and
A2UI payloads remain server-side. The authorization package owns every ToolInvocation transition
inside the elicitation transaction; this package owns only the response and exact memory receipt.
Receipt verification rechecks the current single dispatch claim, fence, revision, lease, execution
user, query digest, frozen input digest, and persona. Until a transient memory-delivery path can hand
facts directly to the active model loop without persistence, an accepted receipt stops with the
bounded `safe_delivery_required` outcome before Cognee is called.

## See also

[execution](../../README.md) · [runtime protocol](../../protocol/README.md) · [authorization](../../../../server/iam/authorization/main/README.md)
