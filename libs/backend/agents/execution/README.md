# Shared agent execution

> [backend](../../README.md) › [agents](../README.md) › execution

This group holds the shared execution authority used by both personal and managed agents. It is not an executor process: the claimed runtime Pod consumes decisions made here, but cannot create or rewrite them.

| Capability | Owns |
| --- | --- |
| [admission](./admission/main/README.md) | Managed run composition and bounded process, silo, and service admission. |
| [runs](./runs/README.md) | Durable runs, attempts, saved workflow tasks, and controller lifecycle work. |
| [inputs](./inputs/main/README.md) | Immutable input snapshots assembled from already-authorised records. |
| [protocol](./protocol/README.md) | Fenced runtime commands, candidates, replay, steering, and deferred actions. |
| [elicitation](./elicitation/main/README.md) | Recoverable participant input, exact response authority, and purpose strategies. |

```
managed request -> admission -> inputs -> runs -> protocol -> claimed warm Pod
                                          execution ◄── HERE
```

Dependencies remain inside the backend layer. Execution libraries never import apps, and the untrusted runtime process never becomes an authority.

## See also

[agents](../README.md) · [runtime infrastructure](../runtime/README.md)
