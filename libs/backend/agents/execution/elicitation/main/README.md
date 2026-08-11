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
expired deadline fails closed. Personal-memory permission creates only a one-use receipt; fact
content never passes through the generic elicitation result.

## Public surface

- `__PlanElicitationLifecycle` — exhaustive state and event decision for request finality.
- `OpenElicitationCommand` — server-derived coordinates for one admitted runtime proposal.
- `RespondToElicitationCommand` — authenticated, idempotent response command with server step-up evidence.
- `SelfElicitationQueryRepository` — read port restricted to the active assigned participant.
- `_CreateElicitationInterruptReader` — generic cursorless reconnect overlay for every body type.
- `_CreateSelfElicitationActivityRouter` — bounded derived Activity references over canonical requests.

## Boundary

The package owns request, response-attempt, result-delivery, and one-use memory-permission records.
Tool approval keeps its own audit row, and runtime, browser, and A2UI payloads cannot select the
respondent, dataset, or protected action.

## Dependency direction

Tagged `scope:execution-elicitation` in the backend layer. It may depend on execution-run,
conversation, authorization, authentication, agent-model, utility, and shared contracts, never apps.

## Data & persistence

`elicitation.prisma` owns requests, response attempts, runtime result deliveries, and one-use
personal-memory permission receipts. The clean baseline and adjacent upgrade SQL enforce exact
coordinates, terminal finality, and one accepted response.

Ordinary input answers are delivered to the exact runtime attempt once. Protected tool, memory, and
A2UI payloads remain server-side; only their safe terminal outcome may cross the runtime protocol.

## See also

[execution](../../README.md) · [runtime protocol](../../protocol/README.md) · [authorization](../../../../server/iam/authorization/main/README.md)
