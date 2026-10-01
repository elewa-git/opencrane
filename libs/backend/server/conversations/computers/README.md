# @opencrane/backend/server/conversations/computers — checked computer history

> [backend](../../../README.md) › [server](../../README.md) › [conversations](../README.md) › computers

## What it owns

This package persists and reloads a conversation computer and its current lease. A lease identifies
one running realisation of a computer; its generation increases when that realisation is replaced.
Activation and lifecycle operations supply the intended snapshot and the stream position they read.

```text
activation / lifecycle ── computer snapshot ──► computers ◄── HERE
                                                  │ checked append/read
                                                  ▼
                                             history-store
```

**In this flow:** [activation and lifecycle](../main/README.md) · [history-store](../../infra/history-store/README.md).

The reader checks ownership, profile, generation and event metadata against the stored snapshot.
Missing or mismatched coordinates fail closed. An older lease cannot become current merely because
its Kubernetes workload still exists.

## Public surface

- `ConversationComputerHistory` appends snapshots and loads the checked current computer or active lease.
- Computer command, snapshot and lease coordinate types define inputs and checked read results.
- `_ComputerScopeOf` and `_LeaseScopeOf` map stored snapshots to the shared coordinate bundles.

## Boundary

This package owns the event history invariant. Main owns activation, idle policy, checkpoints,
turns and participant review; the sandbox adapter owns Kubernetes calls. It has no Prisma client
and neither writes authorisation projections nor issues credentials.

## Dependency direction

Tagged `type:lib`, `layer:backend`, `scope:conversations`. It depends on shared contracts and the
history-store port. It never imports participant orchestration, an app or frontend code.

## Runtime & config

The caller supplies a history-store connection. The package derives stream names from trusted
computer coordinates and preserves storage failures for its caller to handle.

## See also

- [Conversations](../README.md)
- [Participant authority](../main/README.md) · [Participant history](../history/README.md)
