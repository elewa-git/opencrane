# @opencrane/backend/agents/skills/execution — durable skill-work authority

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › execution

## What it owns

This package owns the database-fenced claim and assignment contract for isolated candidate-skill and
tenant-tool Jobs. The OpenCrane server gives the agent controller a single authenticated internal
route; the controller claims a workload, creates a still-suspended Job, then returns the
Kubernetes-issued Job UID for an exact durable assignment.

```
 durable SkillWorkload ──► controller-only API ──► claim generation
                                      │                  │
                                      ▼                  ▼
                         skills/execution ◄── HERE   suspended Job
                                      │                  │
                                      └──── exact UID ◄──┘
```

**In this flow:** [skill Job builder](../../k8s-launcher/README.md) ·
[agent controller](../../../../../../../apps/agent-controller/README.md).

A claim identifies one durable delivery generation; an assignment can bind only the Kubernetes Job
UID created for that exact generation. At that same durable step it hashes the opaque reference
already projected into the Job and creates the one-use bootstrap record. This order makes a crash
safe: an uncommitted Job remains suspended and is safe to adopt later, while a stale controller
cannot attach a different Job or replace its reference.

It does not create Kubernetes resources, exchange worker capabilities, read ArtifactStore bytes, or
complete tool invocations. Those responsibilities remain downstream of the durable authority.

## Public surface

- `SkillWorkloadClaim` — one database-issued delivery generation.
- `SkillWorkloadAssignmentCommand` — the controller's exact suspended-Job UID and opaque-reference fence.
- `PrismaSkillWorkloadClaimsRepository` — Postgres implementation of the fenced claim and commit.
- `__CreateSkillWorkloadDispatchRouter` — projected-token-authenticated internal claim and assignment API.

## Boundary

The controller is the sole Kubernetes mutator. A worker never receives permission to alter this
record, so retries, crash recovery, and future replies all start from Postgres rather than a Job.
The route rejects every identity except the controller's dedicated Kubernetes ServiceAccount, and it
accepts no caller-selected namespace, image, capability, or Job profile.

## Dependency direction

Tagged `scope:skills` and `layer:backend`, this package may use the skill authority and shared
contracts but never an app, Kubernetes client, or controller implementation. The OpenCrane server
composes the HTTP route; the controller consumes it through an outbound adapter.

## Data & persistence

The package owns the claim and assignment transitions on `SkillWorkload`. The clean target baseline
enforces its pending → assigned state fence, monotonic delivery generation, immutable Job UID, and
terminal cancellation independently of this TypeScript adapter. It also owns the one-use
`SkillWorkloadBootstrap` record: only a SHA-256 hash of the worker reference is stored, and it is
bound to the exact assigned Job UID plus the fixed namespace, ServiceAccount, audience, expiry, and
one consuming Pod UID. The later worker exchange may consume that record, but cannot turn it into a
general artifact or runtime credential.

## See also

- Job manifest builder: [k8s launcher](../../k8s-launcher/README.md)
- Parent group: [skills](../../../README.md)
- Deployment planes: [skill authoring](../../../../../../../apps/skill-authoring/README.md) and
  [tool runner](../../../../../../../apps/tool-runner/README.md)
