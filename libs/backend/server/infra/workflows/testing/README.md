# @opencrane/backend/server/infra/workflows/testing — workflow engine tests

> [infra](../../README.md) › [workflows](../README.md) › testing

## What it owns

This package gives engine adapters one reusable contract suite and gives domain tests a deterministic
in-memory execution port. The suite drives a fresh adapter harness; the fake models local and remote
task admission, events, child results, cancellation, and worker dispatch without a database or engine.

```text
 adapter harness ──► [ testing ◄── HERE ] ──► contract assertions
 domain test ──────► fake execution ────────► deterministic task state
```

**In this flow:** the [contract](../contract/README.md) package.

The fake guarantees deterministic IDs and states for tests. It does not emulate engine persistence,
retries, future time, or production transaction validation.

## Public surface

- `__FakeWorkflowEngine` — deterministic `IWorkflowEngine` implementation that keeps declared remote
  tasks pending without a local handler.
- `__TestWorkflowEngineContract` — reusable Vitest suite for fake and real workflow engines.
- `IWorkflowHarness`, `IWorkflowHarnessFactory`, and fake task-snapshot types.

## Boundary

Adapter and domain tests consume this package. Production composition must import the contract and a
real adapter instead; this package has no engine, database, or deployment authority.

## Dependency direction

This is a `layer:infra`, `scope:workflows` test-support library. It may depend on the workflows
contract but must not import backend domains, applications, database clients, or an execution engine.

## See also

- Sibling: [contract](../contract/README.md)
- Parent: [workflows](../README.md)
