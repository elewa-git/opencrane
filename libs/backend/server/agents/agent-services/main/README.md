# @opencrane/backend/server/agents/agent-services — managed-agent definition plane + management API

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package is part of the **managed-agent plane** — the side of OpenCrane that turns a saved
agent definition into something the runtime can execute. An *agent service* is the stable identity
of one agent (its name and lifecycle); an *agent revision* is one immutable, versioned snapshot of
how that agent behaves (its prompt policy, registered model definition, budget, and the skills and
integrations it may use). A service always points at exactly one *active* revision.

This package owns the whole definition plane and the authoritative management API. It creates a
managed service with its first draft revision, accepting only the deployed `managed-default`
workload profile so an admitted service always has an executable controller target; appends immutable draft revisions as edits (each
recording its parent revision and a change message); restores an older revision by cloning it into
a new revision that records both its parent and its source; publishes a draft (flipping the active
pointer under compare-and-swap); moves the service through enable/pause/retire under optimistic
concurrency; compares any two revisions (line-level prompt diff, semantic config diff, and
security-widening flags); reads run history; and records a run-now admission on the shared run
substrate. Revisions are immutable and form an ordered lineage — an edit never mutates published
history. Each revision carries revision-scoped knowledge scope attachments using the canonical
`{ scope, subjectType, subjectId }` vocabulary; an attachment authorises scoped knowledge
read/recall and inject/write for that exact scope only, and never implies skills, MCP tools,
models, credentials, or a neighbouring scope.

```
 author a draft AgentRevision   (prompt policy · registered model · budget · assigned skills + integrations)
        │
        ▼
 ┌────────────────────────────────────┐
 │  agent-services  ◄── HERE           │  draft owned by this service? immutable + complete?
 │                                     │  is the active pointer still what the caller expected?
 └────────────────────────────────────┘
        │  publish the revision + flip the active pointer  (one compare-and-swap)
        ▼
 runtime executes the service's active revision
```

**In this flow:** [skills](../../skills/main/README.md) · [integrations](../../../gateways/integrations/main/README.md) *(a revision assigns these)*

Invariant: a revision is only published when it belongs to the named service, is still a draft, and
carries every executable field (a positive version, a digest, prompt and registered model definition,
and positive turn/token/duration budgets). Every assigned integration and allowed tool name must also
be a non-empty, unambiguous identifier: colons are rejected because the runtime compiles the frozen
assignment into `integration:<integrationId>:<toolName>`. The model is a foreign-key reference to the
gateway-owned catalogue, so an author cannot turn an arbitrary provider alias into executable
behaviour. A model is available only when it is platform-global or belongs to the service's tenant
scope; the database checks the same rule as the application. The publish and the pointer flip happen
as a single compare-and-swap, so two people publishing at once cannot both win — the second sees a
conflict, and a crash never leaves a half-published service. Anything missing or stale is refused
with a plain reason.

## Public surface

- `__CreateAgentServicesRouter` — the authoritative management router (catalogue / create / revise /
  compare / publish / restore / enable / pause / run-now / history / retire); the UI and parity client are
  clients of it. Composed with `AgentServicesRouterDependencies`, `ManagementCaller`, `ManagementClock`.
- `_CreateAgentServicesRouter` — the ready-to-mount Prisma composition. It maps the authenticated
  request principal into `ManagementCaller`, owns all database adapters and audit-evidence wiring,
  and accepts only the shared run-admission port plus the process logger from the app.
- Lifecycle use cases: `__CreateManagedAgentService`, `__ReviseAgentRevision`, `__RestoreAgentRevision`,
  `__ChangeAgentServiceState`, `__CompareAgentRevisions`, `__ReadAgentServiceHistory`, `__AdmitManagedRunNow`.
- `PrismaAgentRevisionLifecycleRepository` — Postgres-backed definition-plane adapter (immutable
  revisions, lineage, optimistic concurrency).
- `AgentRevisionModelSelectionRepository` and
  `PrismaAgentRevisionModelSelectionRepository` — the port and transaction-scoped model-alias strategy used when
  personal configuration must combine an accepted model selection with its own journal transition.
  Agent-services proves the frozen source, reconstructs its canonical content, changes only the
  model definition, appends and publishes the next revision, and activates it. The personal
  configuration unit of work owns the surrounding Serializable transaction and final proposal
  compare-and-set; agent-services never exposes its ORM delegates to the materializer.
- `AgentRevisionModelSelectionMaterializationCodes` — the documented cross-package result vocabulary
  for that model-selection seam. It preserves its serialized outcomes while preventing personal
  configuration from inventing or drifting from agent-services' source-fence results.
- `__PublishAgentRevision` + `PrismaAgentServicePublicationRepository` — the reused compare-and-swap
publish path and its Postgres adapter. Retiring a service clears its active-revision pointer in the
same database update, so no retired service can still look runnable.
- `ManagedRunAdmissionPort` — the app-owned seam through which run-now AND the scheduler record an
  admission (`trigger: managed_invocation` or `schedule`). `ManagedRunAdmissionOutcomes` is its
  documented serialized outcome vocabulary, so consumers do not recreate accepted, idempotent, or
  denied branch values.
- Schedule plane: `__CreateAgentSchedule`, `__UpdateAgentSchedule`, `PrismaAgentScheduleRepository`,
  the shared `AgentScheduleOverlapPolicies` vocabulary, and the `/:serviceId/schedules` management
  surface (list/create/update/delete). Evaluation into due runs lives in sibling `scheduling`.
- Scope attach-authority + effective access: `__ValidateAttachAuthority`,
  `__ResolveEffectiveScopeAttachments`, `__IntersectScopeAttachments`, `PrismaScopeGrantResolver`.
- Managed execution evidence: `PrismaManagedExecutionEvidenceAuthority` derives the canonical
  `agent-service:<id>` principal, verifies its current signed fleet membership, intersects the
  active revision's non-personal scope attachments with effective grants, and digests the complete
  capability-bearing revision inside the run-admission transaction.
- `_CreateManagedExecutionEvidenceAuthority` — owns the fail-closed environment policy for fleet
  issuer, key identifier, mounted public-key source, and maximum membership staleness. The public key
  is reloaded for every decision so a projected Secret rotation takes effect immediately.
- Types: the lifecycle commands/results (`CreateManagedAgentServiceCommand`,
  `ReviseAgentRevisionCommand`, `RestoreAgentRevisionCommand`, `ChangeAgentServiceStateCommand`,
  `ManagedRunNowCommand`, `AgentRevisionLifecycleRepository`, `AgentServiceHistory`, …), the publish
  contract
  (`PublishAgentRevisionCommand`/`Result`/`FailureReason`, `AtomicAgentRevisionPublication*`), and
  `AgentPublicationAuditEvidencePort` — the seam through which publication records audit evidence.
  The shared `AgentRevisionContent` domain value lives in `@opencrane/models/agents`.

## Boundary

The application mounts the exported Prisma composition and supplies the cross-domain run-admission
port. This package owns its router, caller mapping, database adapters, revision persistence, and
publication-audit wiring. A cross-domain unit of work may bind the model-selection repository to its
transaction, but personal configuration cannot reproduce its revision projection, Prisma mapping,
or lifecycle. This package does not run agents or resolve skills/integrations itself. It fails closed:
any doubt is a `denied` outcome, never a silent partial publish.

## Dependency direction

Tagged `scope:agent-services`: it may depend only on `scope:agent-services`, `scope:agents` (shared
agent models), `scope:audit`, `scope:auth`, `scope:authorization`, `scope:grants`,
`scope:membership`, and `scope:shared` — never on apps, gateways, or knowledge domains. The
`scope:auth` edge resolves only the backend-type-free request principal; run admission remains an
injected port, so this package never imports `scope:execution-runs`. The `scope:grants` edge is real and
load-bearing: `PrismaScopeGrantResolver` calls the IAM grant compiler so `__ValidateAttachAuthority`
(a caller must administer every scope they attach) and `__ResolveEffectiveScopeAttachments` (the
runtime intersection, so a stored attachment grants nothing beyond the agent's actual compiled
grants) both ride the compiler. The resolver treats a Grant's principal as the receiver and its
Awareness `payloadId` as the attached knowledge target, preventing a receiver identifier from being
mistaken for a project, team, department, organization, or personal dataset. The membership edge is equally narrow: managed execution freezes
fresh signed service-principal evidence into its immutable snapshot. Scope attachments remain
silo-bounded and org-admin-gated.

## Data & persistence

Owns the `AgentService`, `AgentRevision` (with `parentRevisionId`/`sourceRevisionId`/`changeMessage`
lineage and a required `ModelDefinition` reference), `AgentRevisionScopeAttachment` (revision-scoped `{ scope, subjectType, subjectId }` reusing
the `GrantScope`/`GrantSubjectType` enums), `AgentRevisionSkillAssignment`,
`AgentRevisionIntegrationAssignment`, and `AgentServiceSchedule` (cron, timezone, overlap policy,
enabled, catch-up window) models in `apps/opencrane/prisma/schema/agent-services.prisma`.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [channel-targets](../../channel-targets/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
