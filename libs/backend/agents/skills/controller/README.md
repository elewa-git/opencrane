# @opencrane/backend/agents/skills/controller — skill-authoring validation Job controller

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package contains the Kubernetes work for skill-authoring validation Jobs. A workflow is a saved task that can wait,
retry, and continue after a restart. The agent controller registers the Python validation workflow
handler and uses it to create, observe, and clean up one restricted Job.

```
 saved Python validation task ──► controller ◄── HERE ──► restricted authoring Job
                                      │                         │
                                      └─ saved UID and Pod identity ─┘
```

**In this flow:** the shared [workflow task contract](../workflows/contract/README.md) and the
[Job builder](../k8s-launcher/README.md).

The Job stays suspended until a separate, database-fenced release claim authorises one conditional
unsuspend. The controller then records the exact first Job-owned Pod before the worker bootstrap can
be used. A crash can therefore leave an inert Job to exact-adopt later, but cannot leave unrecorded
Python code running.

## Public surface

- `__CreateKubernetesSkillAuthoringValidationStore` — supplies authoring-validation labels and trace names to
  the shared exact governed Job store.
- `__CreateSkillAuthoringValidationHandler` — returns the registered workflow handler. It records
  Job and Pod IDs, checks the saved result every second, retries expired delivery claims, and removes
  only the exact Job it recorded.

## Boundary

This package accepts ports for OpenCrane and Kubernetes; it does not use Prisma, issue a capability,
read artifact bytes, duplicate controller wire validators, or run a worker. The workflow handler
records a Job ID before release and a Pod ID before it can accept a worker result.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend on the pure skill Job builder, the
shared exact governed Job controller, engine-neutral workflow contract, dependency-light skill task
contract, and shared contracts. It does not import the backend workflow-admission implementation.
The deployable agent-controller app composes its HTTP and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
