# @opencrane/backend/agents/skills/execution — durable skill-work authority

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › execution

## What it owns

This package owns the remaining database lifecycle for isolated tenant tool Jobs.
The OpenCrane server composes one unit of work (a short, all-or-nothing database operation) and one
application authority, then gives the agent controller a single authenticated internal route. The
controller claims a workload, creates a still-suspended Job, and returns its Kubernetes-issued UID
for an exact durable assignment.

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
UID created for that exact generation. The transaction-scoped assignment repository owns that
transition, while a separate release repository owns unsuspending the Job and registering its first
Pod. At assignment it hashes the opaque reference already projected into the Job and creates the
one-use bootstrap record. This order makes a crash safe: an uncommitted Job remains suspended and
is safe to adopt later, while a stale controller cannot attach a different Job or replace its
reference.

It does not create Kubernetes resources, grant a worker capability, hold ArtifactStore credentials,
or complete tool invocations. It exposes a narrow one-use acknowledgement route: the tool worker
can consume its hash-addressed record only after TokenReview confirms the exact registered Pod. It
does not accept skill-authoring Jobs. Python skill validation now runs as a saved workflow task through
the sibling workflow packages. A tool-runner result must complete its linked `ToolInvocation`.

## Public surface

- `SkillWorkloadClaim` — one database-issued delivery generation.
- `SkillWorkloadAssignmentCommand` — the controller's exact suspended-Job UID and opaque-reference fence.
- `PrismaSkillWorkloadUnitOfWork` — the sole root Prisma client and transaction owner for this package.
- `_CreateSkillWorkloadExecutionAuthority` — composes transaction-scoped assignment, release, and
  bootstrap repositories for the two internal routes.
- `__CreateSkillWorkloadDispatchRouter` — projected-token-authenticated internal claim and assignment API.
- `__CreateSkillWorkloadBootstrapRouter` — consumes one opaque bootstrap reference only for the
  exact TokenReview-confirmed worker Pod.

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

The package owns the claim, assignment, release, first-Pod, and bootstrap transitions for tool-runner `SkillWorkload` rows. The
clean target baseline enforces its pending → assigned → terminal state fence, monotonic delivery
generation, immutable Job UID, canonical worker Pod, and terminal receipt independently of this
TypeScript adapter. Typed read-only Prisma views retain database-clock expiry and PostgreSQL
`SKIP LOCKED` selection without giving the adapter a raw-query capability; serializable transactions
and exact delegate updates preserve each claim fence. Database triggers replace timestamp proposals
with their own clock and create the bounded bootstrap expiry. It also owns the one-use
`SkillWorkloadBootstrap` record: only a SHA-256 hash of the worker reference is stored, and it is
bound to the exact assigned Job UID plus the fixed namespace, ServiceAccount, audience, expiry, and
the controller-registered canonical worker Pod UID. It cannot turn the record into a general artifact
or runtime credential.

## See also

- Job manifest builder: [k8s launcher](../../k8s-launcher/README.md)
- Parent group: [skills](../../../README.md)
- Deployment planes: [skill authoring](../../../../../../../apps/skill-authoring/README.md) and
  [tool runner](../../../../../../../apps/tool-runner/README.md)
