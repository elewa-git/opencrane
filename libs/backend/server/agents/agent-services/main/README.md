# @opencrane/backend/server/agents/agent-services — managed-agent definition plane + management API

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package is part of the **managed-agent plane** — the side of OpenCrane that turns a saved
agent definition into something the runtime can execute. An *agent service* is the stable identity
of one agent (its name and lifecycle); an *agent revision* is one immutable, versioned snapshot of
how that agent behaves (its prompt policy, model policy, budget, and the skills and integrations it
may use). A service always points at exactly one *active* revision.

This package owns the whole definition plane and the authoritative management API. It creates a
managed service with its first draft revision; appends immutable draft revisions as edits (each
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
 author a draft AgentRevision   (prompt policy · model policy · budget · assigned skills + integrations)
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
carries every executable field (a positive version, a digest, prompt and model policy, and positive
turn/token/duration budgets). The publish and the pointer flip happen as a single compare-and-swap,
so two people publishing at once cannot both win — the second sees a conflict, and a crash never
leaves a half-published service. Anything missing or stale is refused with a plain reason.

## Public surface

- `__CreateAgentServicesRouter` — the authoritative management router (create / revise / compare /
  publish / restore / enable / pause / run-now / history / retire); the UI and parity client are
  clients of it. Composed with `AgentServicesRouterDependencies`, `ManagementCaller`, `ManagementClock`.
- Lifecycle use cases: `__CreateManagedAgentService`, `__ReviseAgentRevision`, `__RestoreAgentRevision`,
  `__ChangeAgentServiceState`, `__CompareAgentRevisions`, `__ReadAgentServiceHistory`, `__AdmitManagedRunNow`.
- `PrismaAgentRevisionLifecycleRepository` — Postgres-backed definition-plane adapter (immutable
  revisions, lineage, optimistic concurrency).
- `__PublishAgentRevision` + `PrismaAgentServicePublicationRepository` — the reused compare-and-swap
  publish path and its Postgres adapter.
- `ManagedRunAdmissionPort` — the app-owned seam through which run-now AND the scheduler record an
  admission (`trigger: managed_invocation` or `schedule`).
- Schedule plane: `__CreateAgentSchedule`, `__UpdateAgentSchedule`, `PrismaAgentScheduleRepository`,
  and the `/:serviceId/schedules` management surface (list/create/update/delete). Evaluation of a
  schedule into due runs lives in the sibling `scheduling` package.
- Scope attach-authority + effective access: `__ValidateAttachAuthority`,
  `__ResolveEffectiveScopeAttachments`, `__IntersectScopeAttachments`, `PrismaScopeGrantResolver`.
- Types: the lifecycle commands/results (`AgentRevisionContent`, `CreateManagedAgentServiceCommand`,
  `ReviseAgentRevisionCommand`, `RestoreAgentRevisionCommand`, `ChangeAgentServiceStateCommand`,
  `ManagedRunNowCommand`, `AgentRevisionLifecycleRepository`, `AgentServiceHistory`, …), the publish
  contract (`PublishAgentRevisionCommand`/`Result`/`FailureReason`, `AtomicAgentRevisionPublication*`),
  and `AgentPublicationAuditEvidencePort` — the seam through which publication records audit evidence.

## Boundary

The application layer composes the use case with the Prisma adapter and calls it. This package does
not author drafts, run agents, or resolve skills/integrations itself — it only flips the active
pointer once a draft is proven publishable. It fails closed: any doubt is a `denied` outcome, never
a silent partial publish.

## Dependency direction

Tagged `scope:agent-services`: it may depend only on `scope:agent-services`, `scope:agents` (shared
agent models), `scope:audit`, `scope:authorization`, `scope:grants`, and `scope:shared` — never on
apps, gateways, or knowledge domains. run-now and session reading are injected by the app so this
package never imports `scope:auth` or `scope:execution-runs`. The `scope:grants` edge is real and
load-bearing: `PrismaScopeGrantResolver` calls the IAM grant compiler so `__ValidateAttachAuthority`
(a caller must administer every scope they attach) and `__ResolveEffectiveScopeAttachments` (the
runtime intersection, so a stored attachment grants nothing beyond the agent's actual compiled
grants) both ride the compiler. Scope attachments remain silo-bounded and org-admin-gated.

## Data & persistence

Owns the `AgentService`, `AgentRevision` (with `parentRevisionId`/`sourceRevisionId`/`changeMessage`
lineage), `AgentRevisionScopeAttachment` (revision-scoped `{ scope, subjectType, subjectId }` reusing
the `GrantScope`/`GrantSubjectType` enums), `AgentRevisionSkillAssignment`,
`AgentRevisionIntegrationAssignment`, and `AgentServiceSchedule` (cron, timezone, overlap policy,
enabled, catch-up window) models in `apps/opencrane/prisma/schema/agent-services.prisma`. The retired
single-owner shape (`ownerScope`/`ownerSubjectId`/`AgentServiceOwnerScope`) is dropped.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
