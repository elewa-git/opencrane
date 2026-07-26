# Shared agent execution

> [backend](../../README.md) › [agents](../README.md) › execution

This group holds the shared execution authority used by both personal and managed agents. It is not an executor process: the runtime Job consumes decisions made here, but cannot create or rewrite them.

| Capability | Owns |
| --- | --- |
| [runs](./runs/main/README.md) | Durable runs, attempts, fences, events, and outbox work. |
| [inputs](./inputs/main/README.md) | Immutable input snapshots assembled from already-authorised records. |
| [protocol](./protocol/README.md) | Fenced runtime commands, candidates, replay, steering, and deferred actions. |

```
authorised records -> inputs -> runs -> protocol -> runtime Job
                                      execution ◄── HERE
```

Dependencies remain inside the backend layer. Execution libraries never import apps, and the untrusted runtime process never becomes an authority.

## See also

[agents](../README.md) · [runtime infrastructure](../runtime/README.md)
