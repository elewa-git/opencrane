# @opencrane/backend/agents/skills/controller — governed skill Job reconciliation

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › controller

## What it owns

This package is the outbound reconciliation step between the durable skill-work authority and
Kubernetes. A **reconciler** repeatedly makes an external system match a durable desired state. It
claims one authorised workload, builds a hardened but still-suspended Job from its fixed class
profile, and commits the Kubernetes-issued Job UID plus the Job's stable opaque reference back to
OpenCrane. A second reconciliation claims the durable release fence, makes one UID-and-resource-
version-fenced `suspend: true` to `false` change, then records the first uniquely owned worker Pod.

```
 Postgres workload claim ──► controller ◄── HERE ──► suspended Job
          │                         │                   │
          └──── database fence ◄────┴──── immutable UID ┘
                                                    │
                         release fence ─────────────┴──► released Job ──► first Pod UID
```

**In this flow:** [execution authority](../execution/main/README.md) ·
[Job builder](../k8s-launcher/README.md).

The Job stays suspended after assignment. Release is a separate durable step: a crash after the
Kubernetes patch is safe because the next poll exact-adopts the now-released Job, commits the same
release fence idempotently, and finishes Pod registration. A worker cannot use its bootstrap path
until that Pod identity is registered.

## Public surface

- `__ReconcileNextSkillWorkload` — handles at most one fenced claim and suspended Job assignment.
- `__ReconcileNextSkillWorkloadRelease` — releases one exact assigned Job and registers its first Pod.
- `__RunSkillWorkloadController` — polls until process shutdown while isolating one failed claim.
- `__ValidateSkillWorkloadControllerProfiles` — validates the two deployment-owned job-class profiles.

## Boundary

This package accepts ports for OpenCrane and Kubernetes; it does not use Prisma, issue a capability,
read artifact bytes, or run a worker. The Kubernetes port can only create/exact-adopt a Job, make its
one guarded release patch, and list its one owner-selected Pod. A later worker protocol exchanges
the non-secret Job reference through a separately authenticated boundary.

## Dependency direction

Tagged `scope:skills-controller` and `layer:infra`, it may depend only on the pure skill Job builder
and shared contracts. The deployable agent-controller app composes its HTTP and Kubernetes adapters.

## See also

- Parent group: [skills](../README.md)
- Durable authority: [execution](../execution/main/README.md)
- Manifest policy: [k8s launcher](../k8s-launcher/README.md)
