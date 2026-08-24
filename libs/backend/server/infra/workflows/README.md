# workflows — saved control-plane work

> [infra](../README.md) › workflows

These libraries define how a control-plane action saves work that survives a server restart. A
workflow is work that may take time, wait for something, and continue later. The OpenCrane server
uses Absurd to save and run this work, while product code uses the shared workflow rules instead of
talking to Absurd directly.

## Map

| Package | What it owns |
| --- | --- |
| [contract](./contract/README.md) | The engine-neutral workflow port, shared queue authority, and server-only worker lifecycle types. |
| [guard](./guard/README.md) | Silo, task-name, payload, queue, and tracing guardrails. |
| [oauth-refresh](./oauth-refresh/README.md) | One saved refresh task for each connection scope and OAuth connection, without storing a credential in the task. |
| [scheduler](./scheduler/README.md) | Finite respawn chains for product-owned recurrence. |
| [infra_absurd](./infra_absurd/README.md) | The pinned Absurd engine adapter and its transaction-bound task admission. |
| [testing](./testing/README.md) | Deterministic contract tests and an in-memory execution fake. |

```text
 product authority ──► guard ──► contract ──► infra_absurd ──► PostgreSQL
                              ▲                 ▲
                    scheduler │                 │
                              │          server composition ──► worker lifecycle
                           testing
```

## Dependency rule

Every child has `type:lib` and `scope:workflows`. The shared API is `layer:contract`; the packages
that enforce policy or talk to Absurd are `layer:infra`. They may depend only on sibling workflow
contracts and shared infrastructure. They must never import a backend domain or application;
product scheduling, authorisation, and database writes stay with their existing owners.

## See also

- Parent: [server infrastructure](../README.md)
- Architecture decision: [ADR 0013](../../../../../docs/adr/0013-workflow-control-plane.md)
