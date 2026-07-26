# @opencrane/backend/server/agents/skills — publish a skill revision

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › skills

## What it owns

A *skill* is a reusable capability an agent can be given — packaged code plus its metadata. Like an
agent service, a skill has a stable identity and many immutable, versioned *revisions*. The actual
bundle of bytes for a revision is not stored here: it lives in the artifact store and is referenced
by an exact SHA-256 content address (a fingerprint computed from the bytes). This package is the
authority that publishes a reviewed skill revision.

It is the final step of the authoring flow. A bundle is authored, uploaded as an artifact, then
tested, scanned, and signed by an isolated job; this package publishes the revision only when that
server-owned review evidence and the artifact reference still line up. Its read-only catalogue API
is composed by the OpenCrane app: an authenticated browser session and request host select the
silo, and callers see only safe skill metadata.

```
 authored skill bundle  ──►  ArtifactRevision (exact content address)
        │  + review evidence (test report · security/secret/licence/malware scan · signature)
        ▼
 ┌──────────────────────────────────┐
 │  skills  ◄── HERE                 │  revision in review? artifact still published?
 │                                   │  content address matches the reviewed one?
 └──────────────────────────────────┘
        │  publish the immutable SkillRevision + advance the current pointer  (atomically)
        ▼
agent revisions assign the published skill ──► admission confirms it remains published
```

**In this flow:** [artifacts](../../artifacts/main/README.md) *(holds the bundle)* · [agent-services](../../agent-services/main/README.md) *(assigns the skill)*

Invariant: publication is bound to an *exact* artifact revision. The skill bytes are always an exact
`ArtifactRevision` reference — this package never stores bundle content and never speaks a package
registry protocol. It publishes only when the revision is in the `review` state, the referenced
artifact is still published, and the pinned content address matches, all read from one consistent
snapshot; the publish and pointer advance happen atomically. A mismatched or unpublished artifact,
or a revision not in review, fails closed with a stable reason. A published revision can later be
revoked: revocation atomically changes `published → revoked`, clears the current pointer only when
it targets that exact revision, and prevents new run admissions from freezing it. It never mutates
or invalidates inputs already accepted for a run.

## Public surface

- `__PublishSkillRevision` — the use case: verify evidence and artifact, then publish atomically.
- `PrismaSkillAuthorityRepository` — locks the scoped skill, revision, and exact artifact before it
  changes `review → published` and advances the current-revision pointer in one transaction.
- `__RevokeSkillRevision` — the future-only withdrawal use case for an exact published revision.
- `PrismaSkillAuthorityRepository.revokeAtomically` — shares the publication lock order, changes
  `published → revoked`, and conditionally clears the live current-revision pointer.
- `__CreateSkillCatalogueRouter` — serves `GET /api/v1/skills`, a bounded catalogue of skill name,
  description, lifecycle, and current-revision state in the trusted host silo.
- `SkillCatalogueRepository` and `SkillCatalogueEntry` — the narrow read boundary and safe summary
  shape used by the browser catalogue.
- Types: `SkillAuthorityRepository` (the persistence boundary), `PublishSkillRevisionCommand`,
  `PublishSkillRevisionResult`, `SkillPublicationEvidence`, `SkillPublicationSnapshot`, and the
  atomic result `AtomicPublishSkillRevisionResult`.

## Boundary

The application layer supplies the Prisma-backed `SkillAuthorityRepository` and calls the use case.
This package does not author, test, scan, or sign bundles, and it does not store bytes — it only
records that a reviewed revision is now published, consistently with the artifact authority.
It is not an OCI/package registry, has no internal bundle-download route, and does not configure or
communicate with the retired `feat-skill-registry` workload. It does not re-evaluate or cancel
already accepted runs; their immutable snapshots remain the audit record.

The catalogue deliberately excludes artifact content addresses, bundle bytes, manifests,
requirements, test and scan evidence, signatures, signer keys, reviewer identities, and all
authoring or tool-runner workload coordinates. It is a discovery surface, not a skill authoring,
publication, download, or execution API.

## Dependency direction

Tagged `scope:skills`: it may depend only on `scope:artifacts`, `scope:cluster-tenants`,
`scope:grants`, `scope:skills`, and `scope:shared` — never on apps, gateways, or other agent
domains directly.

## Data & persistence

Owns `Skill`, `SkillRevision`, and the authoring-only `SkillWorkload` request in
`apps/opencrane/prisma/schema/skills.prisma`. A workload is durable evidence, not a Kubernetes
queue: it begins pending only for a sandboxed draft and is cancelled when that draft becomes
ineligible. Tool-runner admission stays fail-closed until its snapshot-bound authority exists. A
companion SQL authority test lives in `tests/skill-authority.sql`.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [artifacts](../../artifacts/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
