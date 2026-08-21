# @opencrane/backend/server/infra/workflows/scheduler — durable respawn chains

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › scheduler

## What it owns

This library keeps a recurring durable workflow from becoming one task that sleeps forever. A
recurrence owner, such as a product scheduler that already understands cron and timezones, gives it
one stable chain identity and one slot identity. The library asks the durable-execution port to
admit the chain head or, after a task completes, one new task for the next slot.

```
 product scheduler  ──► deterministic chain + slot identities
                                  │
                                  ▼
 ┌──────────────────────────────────────────┐
 │ workflows/scheduler  ◄── HERE             │  ensure head / completed task → successor
 └──────────────────────────────────────────┘
                                  │  transaction-bound durable task spawn
                                  ▼
 workflows/contract  ──► durable engine task (one bounded checkpoint history)
```

**In this flow:** `workflows/contract` *(the transaction-bound durable-execution port)* · the
product scheduler *(owns cron, timezone, and the next slot)*

The invariant is that a successor has a different deterministic slot key and is admitted only with
completion evidence from its predecessor. Repeating an ensure or successor call is safe because the
durable engine receives the same idempotency key. A terminated chain is repaired by ensuring its
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
the next slot. The durable-execution contract owns task persistence and transaction-bound spawning.
This library connects those two seams; it has no schedule API, worker loop, timer, database model,
or task handler of its own.

## Dependency direction

Tagged `scope:workflows` and `layer:infra`, it may import only the sibling workflow contract and
shared infrastructure. It never imports a product domain or an application composition root.

## See also

- Parent: [workflows](../README.md)
- Related: `workflows/contract` · [managed-agent scheduling](../../../agents/scheduling/main/README.md)
