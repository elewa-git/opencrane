# @opencrane/backend/agents/skills/controller — durable authoring validation

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package contains the controller-side parts of one skill authoring validation workflow. A
workflow is a saved task that can pause and continue after a restart. The controller receives an
already-admitted task, creates a restricted Python Job, records its Job and Pod IDs through the
private server API, and waits for the server to save the worker result.

```
saved validation task ──► controller handler ──► suspended authoring Job
                                  │                        │
                                  └── saved Job and Pod IDs ┘
```

**In this flow:** the [skill workflow contract](../workflows/contract/README.md), the
[authoring Job builder](../k8s-launcher/README.md), and the server's
[skill validation authority](../../../../server/agents/skills/main/README.md).

The Job remains suspended until the server records its immutable Kubernetes UID. The controller
then releases that exact Job and records its only Pod before the worker can use its bootstrap
reference. This lets a restarted controller safely adopt the same Job without starting another one.

## Public surface

- `__ValidateSkillAuthoringValidationJobProfile` — validates the one Helm-owned authoring Job profile.
- `__CreateHttpSkillAuthoringValidationControllerAuthority` — calls the private server API with the
  controller's rotating token and rejects replies for another validation.
- `__CreateSkillAuthoringValidationHandler` — returns the remote Python validation handler that
  records Job and Pod IDs before it accepts the server's persisted completion event.

## Boundary

This package accepts server and Kubernetes ports. It does not use Prisma, read artifact bytes,
create product records, or run Python itself. The server remains responsible for admitting the task
inside its database transaction and for writing the final validation result.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend on the pure skill Job builder, the
engine-neutral workflow contract, and the dependency-light skill task contract; it does not import
the backend workflow-admission implementation. The deployable agent-controller app composes its HTTP
and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
