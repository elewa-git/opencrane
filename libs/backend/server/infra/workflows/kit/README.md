# @opencrane/backend/server/infra/workflows/kit — durable workflow guardrails

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › kit

## What it owns

This library is the application-facing guardrail around durable control-plane work. A workflow is a
piece of work that must survive a server restart, such as waiting for approval or continuing a
multi-step change. Before a domain admits a task, the kit checks that its input belongs to the
configured silo — the isolated organisation boundary — and that its task name uses a reviewed queue.

```
 product domain ──► silo-bound task input
                         │
                         ▼
 ┌─────────────────────────────────────────┐
 │ workflows/kit  ◄── HERE                  │  policy check + payload firewall
 └─────────────────────────────────────────┘
                         │  safe task + shared queue authority
                         ▼
 workflows/contract ──► durable engine adapter
```

**In this flow:** [workflows/contract](../contract/README.md) *(the engine-neutral task port)* ·
`workflows/infra_absurd` *(the current PostgreSQL-backed engine adapter)*

The kit refuses cross-silo input, unreviewed task names, non-JSON values, and fields that look like
credentials before they can become durable database payloads. Its checkpoint wrapper traces only
task name, step name, silo, queue, a hashed task key, and outcome metadata. The shared workflow rules
do not provide the engine's retry number, so the kit does not report a number it cannot verify.

## Public surface

- `__CreateWorkflowKit` — apply one silo's policy and shared queue authority to a durable engine.
- `__CreateWorkflowTaskQueueAuthority` — build the immutable reviewed task-to-queue authority that
  both the kit and engine adapter receive.
- `__WorkflowTaskQueueMap` — derive the reviewed task-to-queue map used by that authority.
- `__WorkflowTaskKeyDigest` — hash an idempotency key before diagnostics use it.
- `WorkflowPayloadFirewallError`, `WorkflowTaskPolicyError` — fail-closed policy outcomes.
- `WorkflowKitOptions`, `WorkflowSiloTaskInput`, `WorkflowTaskPolicy`, and
  `WorkflowStepOutcomes` — the policy and integration types.

## Boundary

Product domains own task behaviour, product data, authorisation, and schedule semantics. The engine
adapter owns PostgreSQL and worker mechanics. This package owns neither: it validates the narrow
handoff between them and never logs task input, event payloads, credentials, raw task keys, database
URLs, or queue connection details.

## Dependency direction

Tagged `scope:workflows` and `layer:infra`, this package may use the sibling workflow contract and
cross-cutting observability support. It never imports a product domain, an application entrypoint,
or the Absurd SDK.

## See also

- Parent: [workflows](../README.md)
- Task port: [workflows/contract](../contract/README.md)
- Recurrence helper: [workflows/scheduler](../scheduler/README.md)
