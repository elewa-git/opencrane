# @opencrane/backend/server/infra/workflows/scheduler — recurring workflow scheduling

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › scheduler

## What it owns

This library helps a product run the same workflow repeatedly without keeping one task alive
forever. The product scheduler decides when the next run is due; this library gives each run its own
workflow task and asks the workflow engine to start it. When a run completes successfully, it creates
the next run. Repeating that request after a restart or retry reuses the same key, so it does not
create a duplicate; a failed or cancelled chain is restarted by the product scheduler.

```
 product scheduler  ──► deterministic chain + slot identities
                                  │
                                  ▼
 ┌──────────────────────────────────────────┐
 │ workflows/scheduler  ◄── HERE             │  ensure head / completed task → successor
 └──────────────────────────────────────────┘
                                  │  transaction-bound workflow task spawn
                                  ▼
 workflows/contract  ──► workflow engine task (one bounded checkpoint history)
```

**In this flow:** `workflows/contract` *(the transaction-bound workflow-engine port)* · the
product scheduler *(owns cron, timezone, and the next slot)*

The invariant is that a successor has a different deterministic slot key and is admitted only with
completion evidence from its predecessor. Repeating an ensure or successor call is safe because the
workflow engine receives the same idempotency key. A terminated chain is repaired by ensuring its
next scheduler-owned head slot; this library does not guess a time, retain a sleeping task, or
interpret product scheduling rules.

## Public surface

- `__EnsureRespawnChainHead` — idempotently admit the task for one chain head slot.
- `__SpawnRespawnChainSuccessor` — admit a fresh next-slot task after a completed iteration.
- `__RespawnChainTaskKey` — derive the stable engine idempotency key for a chain and slot.
- `CompletedRespawnIteration`, `EnsureRespawnChainHeadCommand`,
  `SpawnRespawnChainSuccessorCommand`, `RespawnChainSpawn` — the scheduling boundary types.

## Boundary

The product scheduler owns cron expressions, IANA timezones, catch-up, overlap policy, and choosing
the next slot. The workflow-engine contract owns task persistence and transaction-bound spawning.
This library connects those two seams; it has no schedule API, worker loop, timer, database model,
or task handler of its own.

## Dependency direction

Tagged `scope:workflows` and `layer:infra`, it may import only the sibling workflow contract and
shared infrastructure. It never imports a product domain or an application composition root.

## See also

- Parent: [workflows](../README.md)
- Related: `workflows/contract` · [managed-agent scheduling](../../../agents/scheduling/main/README.md)
