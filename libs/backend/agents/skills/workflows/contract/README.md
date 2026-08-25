# @opencrane/backend/agents/skills/workflows/contract — skill task contract

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › [workflows](../README.md) › contract

## What it owns

This package gives the server and the controller the same small description of the Python skill
validation task: its stable name, retry policy, and identifier-only input. A workflow is a saved task
that can wait and continue later. Keeping this description in a contract package means neither
process needs to import the other process's implementation.

```
 server admits validation task ──► shared task contract ◄── controller registers handler
                                      │
                                      ▼
                         validation id + silo id only
```

**In this flow:** [workflow admission](../main/README.md) saves the task in a database transaction
and [controller](../../../controller/README.md) runs its handler. The shared declaration and
controller registration are wired; a product-facing adapter and browser route still need to call
the admission rule.

The input never contains artifact bytes, credentials, a Kubernetes Job, or a selected queue. The
server composition owns queue choice, while the controller owns the handler implementation.

## Public surface

- `SkillAuthoringValidationTaskDeclaration` supplies the task name and retry policy used by both
  server declaration and controller registration.
- `SkillAuthoringValidationTaskInput` carries only the owning silo and saved validation ID.
- `SkillAuthoringValidationTaskNames` names the single supported Python validation task.

## Boundary

This package has no database, HTTP, Kubernetes, or workflow-engine implementation. It describes the
task but cannot save, run, or cancel one.

## Dependency direction

Tagged `scope:skills-workflow-contract`, it may import only itself and the engine-neutral workflow
contract. Both skill workflow admission and the infrastructure-level controller import it downward.

## See also

- Parent: [workflows](../README.md)
- Siblings: [workflow admission](../main/README.md) · [controller](../../../controller/README.md)
