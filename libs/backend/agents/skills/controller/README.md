# @opencrane/backend/agents/skills/controller — governed skill Job reconciliation

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package contains the outbound Kubernetes work for skill jobs. The current pilot is a
**reconciler**: it repeatedly makes Kubernetes match a saved workload claim. It also exports a
remote workflow handler that later composition will use to create and observe a Job for a saved task.
The server now mounts the private controller lifecycle API, while product admission and deployable
handler registration remain pending.

```
 legacy workload claim ──► controller ◄── HERE ──► suspended Job
                               ▲                   │
 saved remote validation task ─┘──── immutable UID ┘
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
- `__ValidateSkillWorkloadControllerProfiles` — validates the two deployment-owned job-class profiles.
- `__CreateHttpSkillWorkloadControllerAuthority` — bounds and decodes internal responses, then
  delegates every wire shape and echo invariant to the model-adjacent Zod validators in
  `@opencrane/contracts`.
- `__CreateSkillAuthoringValidationHandler` — returns the uncomposed remote Python validation
  handler that records Job and Pod IDs before it accepts the server's persisted completion event.

## Boundary

This package accepts ports for OpenCrane and Kubernetes; it does not use Prisma, issue a capability,
read artifact bytes, duplicate controller wire validators, or run a worker. The retained polling
pilot releases only an exact UID-bound Job under a short durable release claim. When a later
composition registers it, the remote handler records a Job ID before release and a Pod ID before it
accepts a server-persisted completion. A later worker protocol must exchange the non-secret Job
reference through a separately authenticated boundary before any code can run.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend on the pure skill Job builder, the
engine-neutral workflow contract, and the dependency-light skill task contract; it does not import
the backend workflow-admission implementation. The deployable agent-controller app composes its HTTP
and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Durable authority: [execution](../execution/main/README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
