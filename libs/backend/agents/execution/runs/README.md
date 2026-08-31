# AgentRun lifecycle

> [backend](../../../README.md) › [agents](../../README.md) › [execution](../README.md) › runs

This group owns the durable record of one agent execution and each try to complete it. A workflow
is saved work that can pause and continue after a restart, so the controller can safely continue a
run after its own process restarts.

| Child | Owns |
| --- | --- |
| [main](./main/README.md) | AgentRun admission, retries, lifecycle state, and server-side persistence. |
| [workflows](./workflows/README.md) | The shared saved-task vocabulary and database-transaction admission rule. |
| [controller](./controller/README.md) | The controller task that claims and uses one warm runtime Pod. |

```text
 run admission ──► saved workflow task ──► controller ──► claimed warm Pod
                                           runs ◄── HERE
```

Dependencies flow from the controller through the shared task contract to the server authority. The
controller never changes AgentRun state directly.

## See also

[execution](../README.md) · [runtime infrastructure](../../runtime/README.md)
