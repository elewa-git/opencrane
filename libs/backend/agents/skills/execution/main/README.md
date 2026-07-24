# @opencrane/backend/agents/skills/execution — durable skill-work authority

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › execution

## What it owns

This package owns the database-fenced claim and assignment contract for isolated candidate-skill and
tenant-tool Jobs. A claim identifies one durable delivery generation; an assignment can bind only the
Kubernetes Job UID created for that exact generation.

It does not create Kubernetes resources, exchange worker capabilities, read ArtifactStore bytes, or
complete tool invocations. Those responsibilities remain downstream of the durable authority.

## Public surface

- `SkillWorkloadClaim` — one database-issued delivery generation.
- `SkillWorkloadAssignmentCommand` — the controller's exact suspended-Job UID fence.

## Boundary

The controller is the sole Kubernetes mutator. A worker never receives permission to alter this
record, so retries, crash recovery, and future replies all start from Postgres rather than a Job.

## See also

- Job manifest builder: [k8s launcher](../../k8s-launcher/README.md)
- Deployment planes: [skill authoring](../../../../../../../apps/skill-authoring/README.md) and
  [tool runner](../../../../../../../apps/tool-runner/README.md)
