# @opencrane/backend/server/infra/workflows/guard — workflow guardrails

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › guard

## What it owns

This library is the application-facing guard around control-plane workflows. A workflow is saved
work that can continue after a server restart, such as waiting for approval or completing a
multi-step change. Before a domain admits a task, the guard checks that its input belongs to the
configured silo — the isolated organisation boundary — and that its task name uses a reviewed queue.

```
 product domain ──► silo-bound task input
                         │
                         ▼
 ┌─────────────────────────────────────────┐
 │ workflows/guard  ◄── HERE                │  policy check + payload validation
 └─────────────────────────────────────────┘
                         │  safe task + shared queue authority
                         ▼
 workflows/contract ──► workflow engine adapter
```

**In this flow:** [workflows/contract](../contract/README.md) *(the engine-neutral task port)* ·
`workflows/infra_absurd` *(the current PostgreSQL-backed workflow engine adapter)*

The guard parses generic task input with Zod at the engine boundary, then rejects cross-silo input,
non-JSON values, and fields that look like credentials before they can become saved database
payloads. Its checkpoint wrapper traces only task name, step name, silo, queue, a hashed task key,
and outcome metadata. The workflow contract does not expose a truthful engine retry-attempt number,
so the guard deliberately does not invent one.

## Public surface

- `__CreateWorkflowGuard` — apply one silo's policy and shared queue authority to a workflow engine.
- `__CreateWorkflowTaskQueueAuthority` — build the immutable reviewed task-to-queue authority that
  both the guard and engine adapter receive.
- `WorkflowPayloadValidationError`, `WorkflowTaskPolicyError` — fail-closed policy outcomes.
- `IWorkflowGuardOptions`, `IWorkflowTaskPolicy`, and
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
