# @opencrane/backend/server/agents/skills — skill catalogue and validation records

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › skills

## What it owns

A *skill* is a reusable capability an agent can be given — packaged code plus metadata. Like an
agent service, a skill has a stable identity and immutable, versioned revisions. The OpenCrane app
uses this package for the live, read-only catalogue API: an authenticated browser session and
request host select the silo, and callers receive only safe skill metadata. It also stores the
server-only record that starts a Python skill validation workflow.

```
 governed Skill + current SkillRevision
        ▼
 ┌──────────────────────────────────┐
 │  skills  ◄── HERE                 │  trusted silo? bounded, deterministic list?
 │                                   │  browser-safe fields only?
 └──────────────────────────────────┘
        │  safe catalogue summaries
        ▼
browser catalogue  ──► discovery only; never a skill bundle or execution authority

 Draft Python SkillRevision + pinned active artifact
        ▼
 server transaction ──► validation record ──► Absurd task receipt
                         │
                         └── one-use worker bootstrap and completion inbox
```

**In this flow:** [artifacts](../../artifacts/main/README.md) *(holds the bundle)* · [agent-services](../../agent-services/main/README.md) *(assigns skills to managed agent revisions)*

Invariant: the catalogue is limited to 200 skill summaries from the exact trusted silo, in stable
newest-first order. It exposes no artifact addresses, bundle bytes, manifests, requirements, review
evidence, signatures, signer identities, or worker coordinates. A failure to read the catalogue
returns unavailable rather than a partially widened result.

## Public surface

- `__CreateSkillCatalogueRouter` — serves `GET /api/v1/skills`, a bounded catalogue of skill name,
  description, lifecycle, and current-revision state in the trusted host silo.
- `_CreateSkillCatalogueRouter` — the ready-to-mount Prisma composition that authenticates through
  the shared request-principal seam and supplies the catalogue repository.
- `SkillCatalogueRepository` and `SkillCatalogueEntry` — the narrow read boundary and safe summary
  shape used by the browser catalogue.
- `SkillCatalogueStates` and `SkillCatalogueRevisionStates` — the documented serialized lifecycle
  vocabularies used by the browser response and OpenAPI specification.
- `PrismaSkillAuthoringValidationRepository` — transaction-scoped persistence for a Draft Python
  skill validation. It rechecks the selected silo, revision, and active published artifact, then
  creates or reuses the validation record and binds the exact Absurd task receipt. Its caller must
  provide the database transaction that also admits that task.
- `__CreateSkillAuthoringValidationSubmissionRouter` and
  `PrismaSkillAuthoringValidationSubmissionUnitOfWork` — accept only a skill revision ID from an
  authenticated browser, load the silo and artifact details from the database, and save the
  validation and its workflow task in one database transaction.
- `PrismaSkillAuthoringValidationControllerUnitOfWork` — server-side claim, Job/Pod binding, and
  terminal-completion authority for that saved task. It uses short database transactions and only
  accepts the one authoring profile.
- `__CreateSkillAuthoringValidationWorkerRouter` and
  `PrismaSkillAuthoringValidationWorkerUnitOfWork` — expose the one-use bootstrap, immutable input,
  and completion protocol to the exact Python Job Pod. The task checks that saved completion every
  second while the Job is running.

## Boundary

The application mounts both the catalogue and validation-start routes. The controller route lets
only the fixed controller identity bind the Job and Pod. The worker routes let only the fixed
authoring ServiceAccount and bound Pod obtain input and report completion. This package does not
run Kubernetes Jobs, test or scan candidate code, publish or execute skills, or store artifact bytes.

The catalogue deliberately excludes artifact content addresses, bundle bytes, manifests,
requirements, test and scan evidence, signatures, signer keys, reviewer identities, and all
authoring workload coordinates. It is a discovery surface, not a skill authoring,
publication, download, or execution API.

## Dependency direction

Tagged `scope:skills`: it may depend only on artifacts, authentication, cluster tenants, grants,
runtime workload claims, shared code, the skill domain, skill workflow contracts, workload
identity, and shared workflows. It never depends on apps, gateways, or other agent domains
directly.

## Data & persistence

The `Skill`, `SkillRevision`, and `SkillAuthoringValidation` records belong to the broader skill capability in
`apps/opencrane/prisma/schema/skills.prisma`. The validation record holds the task receipt, one-use
bootstrap identity, and worker completion inbox. The forward 0.10.0 migration removes the retired
SQL workload rows and tables after the replacement code is complete.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [artifacts](../../artifacts/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
