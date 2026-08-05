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

It does not create Kubernetes resources, grant a worker capability, hold ArtifactStore credentials,
or complete tool invocations. It exposes the narrow one-use acknowledgement route: the shared worker
can consume its hash-addressed record only after TokenReview confirms the exact registered Pod. It
also selects a pinned, active source artifact for that same Pod and asks an app-owned broker to stream
the bytes; the worker never learns an ArtifactStore lease or endpoint. The authoring terminal route
accepts only two bounded review records on the already-selected draft revision. A tool-runner result
remains a separate authority: it must complete its linked `ToolInvocation`, not write authoring evidence.

## Public surface

- `PrismaSkillWorkloadClaimsRepository` — Postgres implementation of the fenced claim and commit.
- `__CreateSkillWorkloadDispatchRouter` — projected-token-authenticated internal claim and assignment API.
- `__CreateSkillWorkloadBootstrapRouter` — consumes one opaque bootstrap reference only for the
  exact TokenReview-confirmed worker Pod.
- `PrismaSkillAuthoringCompletionRepository` — atomic authoring receipt and Draft-evidence write.
- `__CreateSkillAuthoringCompletionRouter` — authoring-audience-only receipt API with strict input bounds.
- `PrismaSkillAuthoringInputRepository` — exact-worker selection of an active, published, pinned source artifact.
- `__CreateSkillAuthoringInputRouter` — authoring-audience-only byte broker route with no ArtifactStore credential response.

The controller claim, assignment, release, and Pod-registration DTOs and their strict Zod validators
are shared through `@opencrane/contracts`; this package owns their durable transitions, not a second
copy of their transport shapes.

## Boundary

The controller is the sole Kubernetes mutator. A worker never receives permission to alter this
record, so retries, crash recovery, and future replies all start from Postgres rather than a Job.
The controller route rejects every identity except the controller's dedicated Kubernetes
ServiceAccount, and it accepts no caller-selected namespace, image, capability, or Job profile. The
worker acknowledgement route separately TokenReviews the audience selected by the durable bootstrap,
then compares namespace, ServiceAccount, and canonical Pod UID before it consumes the one-use hash.

## Dependency direction

Tagged `scope:skills` and `layer:backend`, this package may use the skill authority and shared
contracts but never an app, Kubernetes client, or controller implementation. The OpenCrane server
composes the HTTP route; the controller consumes it through an outbound adapter.

## Data & persistence

The package owns the claim, assignment, and authoring terminal transitions on `SkillWorkload`. The
clean target baseline enforces its pending → assigned → terminal state fence, monotonic delivery
generation, immutable Job UID, canonical worker Pod, and terminal receipt independently of this
TypeScript adapter. It also owns the one-use
`SkillWorkloadBootstrap` record: only a SHA-256 hash of the worker reference is stored, and it is
bound to the exact assigned Job UID plus the fixed namespace, ServiceAccount, audience, expiry, and
the controller-registered canonical worker Pod UID. A successful authoring receipt can write only
two passed bounded reports to its still-Draft revision. The input query also binds that draft
revision's three artifact coordinates to an active Artifact and published ArtifactRevision in the same
silo before the app signs a short-lived read lease and validates returned metadata. It cannot turn the
record into a general artifact or runtime credential.

## See also

- Job manifest builder: [k8s launcher](../../k8s-launcher/README.md)
- Parent group: [skills](../../../README.md)
- Deployment planes: [skill authoring](../../../../../../../apps/skill-authoring/README.md) and
  [tool runner](../../../../../../../apps/tool-runner/README.md)
