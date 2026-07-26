# @opencrane/backend/agents/skills/controller — governed skill Job reconciliation

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package is the outbound reconciliation step between the durable skill-work authority and
Kubernetes. A **reconciler** repeatedly makes an external system match a durable desired state. It
claims one authorised workload, builds a hardened but still-suspended Job from its fixed class
profile, and commits the Kubernetes-issued Job UID plus the Job's stable opaque reference back to
OpenCrane.

```
 Postgres workload claim ──► controller ◄── HERE ──► suspended Job
          │                         │                   │
          └──── database fence ◄────┴──── immutable UID ┘
```

**In this flow:** [execution authority](../execution/main/README.md) ·
[Job builder](../k8s-launcher/README.md).

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

## Boundary

This package accepts ports for OpenCrane and Kubernetes; it does not use Prisma, issue a capability,
read artifact bytes, or run a worker. It releases only an exact UID-bound Job under a short durable
release claim, then binds one Kubernetes-issued Pod UID. A later worker protocol must exchange the
non-secret Job reference through a separately authenticated boundary before any code can run.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend only on the pure skill Job builder
and shared contracts. The deployable agent-controller app composes its HTTP and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Durable authority: [execution](../execution/main/README.md)
- Manifest policy: [k8s launcher](../k8s-launcher/README.md)
