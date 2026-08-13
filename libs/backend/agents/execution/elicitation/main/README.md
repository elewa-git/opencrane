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

Runtime protocol code passes its existing transaction into `PrismaRuntimeElicitationUnitOfWork`.
That unit constructs one repository from the same transaction and reuses it for the callback. This
keeps the run lock, request change, candidate acceptance, and expiry decision in one commit without
letting a generic function carry a Prisma client across the boundary.

## Dependency direction

Tagged `scope:execution-elicitation` in the backend layer. It may depend on execution-run,
conversation, authorization, authentication, agent-model, utility, and shared contracts, never apps.

## Data & persistence

`elicitation.prisma` owns requests, response attempts, runtime result deliveries, and one-use
personal-memory permission receipts. The clean baseline and adjacent upgrade SQL enforce exact
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
