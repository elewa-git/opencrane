# workflows — saved control-plane work

> [infra](../README.md) › workflows

These libraries define how a future control-plane action can save work that survives a server restart.
No OpenCrane application composes an engine or starts a worker yet. Product code will depend on the
engine-neutral contract; it will never import an execution engine or control a worker.

## Map

| Package | What it owns |
| --- | --- |
| [contract](./contract/README.md) | The engine-neutral workflow port, shared queue authority, and server-only worker lifecycle types. |
| [guard](./guard/README.md) | Silo, task-name, payload, queue, and tracing guardrails. |
| [oauth-refresh](./oauth-refresh/README.md) | One saved refresh task for each connection scope and OAuth connection, without storing a credential in the task. |
| [scheduler](./scheduler/README.md) | Finite respawn chains for product-owned recurrence. |
| [infra_absurd](./infra_absurd/README.md) | The pinned Absurd engine adapter and its typed transaction procedure gateway. |
| [testing](./testing/README.md) | Deterministic contract tests and an in-memory execution fake. |

```text
 product authority ──► guard ──► contract ──► infra_absurd ──► PostgreSQL
                              ▲                 ▲
                    scheduler │                 │
                              │          server composition ──► worker lifecycle
                           testing
```

## Dependency rule

Every child has `type:lib`, `layer:infra`, and `scope:workflows`. It may depend only on sibling
workflow contracts, shared infrastructure, and its external engine adapter. It must never import a
backend domain or application; product scheduling, authorisation, and aggregate writes stay with
their existing owners.

## See also

- Parent: [server infrastructure](../README.md)
- Architecture decision: [ADR 0013](../../../../../docs/adr/0013-workflow-control-plane.md)
