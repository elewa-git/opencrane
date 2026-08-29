# @opencrane/backend/agents/skills/controller — governed skill Job reconciliation

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package contains the Kubernetes work for skill Jobs. A workflow is a saved task that can wait,
retry, and continue after a restart. The agent controller registers the Python validation workflow
handler and uses it to create, observe, and clean up one restricted Job. The older polling loop remains
only for tool-runner workloads.

```
 saved Python validation task ──► controller ◄── HERE ──► restricted authoring Job
 tool-runner workload claim ────►    │                         │
                                   saved UID and Pod identity ─┘
```

**In this flow:** the retained [execution authority](../execution/main/README.md), the new shared
[workflow task contract](../workflows/contract/README.md), and the [Job builder](../k8s-launcher/README.md).

The Job stays suspended until a separate, database-fenced release claim authorises one conditional
unsuspend. The controller then records the exact first Job-owned Pod before the worker bootstrap can
be used. A crash can therefore leave an inert Job to exact-adopt later, but cannot leave unrecorded
Python code running.

## Public surface

- `__ReconcileNextSkillWorkload` — handles at most one fenced claim and suspended Job assignment.
- `__ReconcileNextSkillWorkloadRelease` — conditionally releases one assigned Job and registers its
  exact first worker Pod.
- `__RunSkillWorkloadController` — polls until process shutdown while isolating one failed claim.
- `__ValidateSkillWorkloadControllerProfiles` — validates the deployment-owned authoring and tool-runner profiles.
- `__CreateHttpSkillWorkloadControllerAuthority` — bounds and decodes internal responses, then
  delegates every wire shape and echo invariant to the model-adjacent Zod validators in
  `@opencrane/contracts`.
- `__CreateKubernetesSkillWorkloadControllerStore` — supplies skill-owned labels and trace names to
  the shared exact governed Job store.
- `__CreateSkillAuthoringValidationHandler` — returns the registered workflow handler. It records
  Job and Pod IDs, checks the saved result every second, retries expired delivery claims, and removes
  only the exact Job it recorded.

## Boundary

This package accepts ports for OpenCrane and Kubernetes; it does not use Prisma, issue a capability,
read artifact bytes, duplicate controller wire validators, or run a worker. The retained tool-runner
poller releases only an exact UID-bound Job under a short saved release claim. The workflow handler
records a Job ID before release and a Pod ID before it can accept a worker result.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend on the pure skill Job builder, the
shared exact governed Job controller, engine-neutral workflow contract, dependency-light skill task
contract, and shared contracts. It does not import the backend workflow-admission implementation.
The deployable agent-controller app composes its HTTP and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Durable authority: [execution](../execution/main/README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
