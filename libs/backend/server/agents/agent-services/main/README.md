# @opencrane/backend/server/agents/agent-services — agent definition plane + management API

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns the **agent definition plane** — the side of OpenCrane that turns a saved
managed or personal agent definition into something the runtime can execute. An *agent service* is the stable identity
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
and positive turn/token/duration budgets). Every assigned integration tool must carry a non-empty,
unambiguous name, reviewed description, valid object input schema, and matching canonical digest:
colons are rejected because the runtime compiles the frozen
assignment into `integration:<integrationId>:<toolName>`. The model is a foreign-key reference to the
gateway-owned catalogue, so an author cannot turn an arbitrary provider alias into executable
behaviour. A model is available only when it is platform-global or belongs to the service's tenant
scope; the database checks the same rule as the application. The publish and the pointer flip happen
as a single compare-and-swap, so two people publishing at once cannot both win — the second sees a
conflict, and a crash never leaves a half-published service. Anything missing or stale is refused
with a plain reason.

### Personal onboarding handoff

Completed onboarding must leave the user able to start an Agent-session conversation. The
onboarding package owns the surrounding Serializable transaction and the decision about whether the
questionnaire may become complete. The app binds that transaction to this package's agent half through
`PrismaPersonalAgentBootstrapRepository`:

1. It re-reads the pinned persona revision and requires it to be approved, subject-owned, and
   silo-owned. During initial completion that revision must still be active, which rejects a persona
   refresh racing the conclusion. During repair the pin remains historical evidence while the
   owner's current approved persona governs creation or revision.
2. It resolves active personal services for that persona. Exactly one is an idempotent success;
   more than one is an ambiguity and creates nothing.
3. If no service exists, it uses the onboarding identifier as the deterministic AgentService
   identifier. A concurrent retry therefore competes for one database identity instead of creating
   two agents. A row already using that identifier for another authority fails closed.
4. If no service exists, the app adapts model-routing's transaction-scoped configured-default
   resolver into `InitialPersonalAgentDefaultModelResolver`. Agent-services consumes only its stable
   definition identifier or fail-closed denial state; it never reads routing defaults or recreates
   their precedence policy.
5. That publisher creates a `Personal` service in `Draft`, writes revision 1 through the shared
   immutable revision writer, publishes that revision, activates the service, and appends
   publication audit evidence. The onboarding transaction commits all of this with completion, or
   none of it.

The initial revision uses the package-owned initial personal-Agent policy and the
`personal-default` runtime profile. Its skills, integrations, and knowledge-scope attachments are
empty. Personal memory access is not silently granted during onboarding; it follows the separate
user-elicitation and consent flow.

#### Why the first revision has three run limits

Every Agent-session message starts a governed run. A broken model response, repeated tool decision,
stalled provider, or tool that never returns could otherwise hold a worker and continue consuming
model capacity indefinitely. The initial policy therefore records three independent technical
ceilings:

| Limit | Initial value | Failure it bounds |
|---|---:|---|
| Model turns | 64 | A reasoning, retry, or tool-selection loop that keeps producing another model turn. |
| Total model tokens | 256,000 | A run whose prompts and responses keep growing even when each individual turn succeeds. |
| Wall-clock duration | 3,600,000 ms (60 minutes) | Waiting providers, stalled tools, and any run that makes too little progress to hit the other limits. |

The control plane requires, validates, and freezes these values into run input. They do not delete
the conversation, impose a monthly account budget, or affect direct/group messages that do not
invoke an agent. Ordinary runs should finish far below every ceiling. Changing the values later
means writing and publishing another immutable AgentRevision; published history is never edited in
place.

**Runtime qualification:** storing and freezing a ceiling is not, by itself, proof that every
runtime adapter stops at it. A release must qualify visible terminal behaviour for the turn, token,
and elapsed-time boundaries before operators rely on them as end-to-end safety brakes. End-to-end
enforcement is tracked in [issue #651](https://github.com/elewa-git/opencrane/issues/651).

The repository is transaction-scoped by design:

```text
onboarding completion unit of work (owns Serializable commit/retry)
        │ app adapter binds its transaction
        ▼
PrismaPersonalAgentBootstrapRepository
        │ validates persona + service authority
        ▼
PrismaInitialPersonalAgentPublicationRepository
        │ consumes model-routing's resolved definition id
        │ writes service + revision + publication + audit
        ▼
ready personal AgentService, or a fail-closed denial
```

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
- `PrismaAgentRevisionPersonaSelectionRepository` — the transaction-scoped strategy for persona
  approval and onboarding repair. It proves one stable personal service and its latest published
  source, copies every executable field while replacing only `personaRevisionId`, publishes the
  next revision, moves the active pointer, and appends audit evidence before the caller commits.
- `AgentRevisionPersonaSelectionMaterializationCodes` — distinguishes a new revision, an
  idempotent already-current revision, a stale source, unavailable authority, and the valid case
  where persona approval finds no personal agent to update.
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
- Run history and management projections expose the immutable `conversationId` coordinate carried
  by each admitted run; this package does not own the participant conversation or its timeline.
- Types: the lifecycle commands/results (`CreateManagedAgentServiceCommand`,
  `ReviseAgentRevisionCommand`, `RestoreAgentRevisionCommand`, `ChangeAgentServiceStateCommand`,
  `ManagedRunNowCommand`, `AgentRevisionLifecycleRepository`, `AgentServiceHistory`, …), the publish
  contract
  (`PublishAgentRevisionCommand`/`Result`/`FailureReason`, `AtomicAgentRevisionPublication*`), and
  `AgentPublicationAuditEvidencePort` — the seam through which publication records audit evidence.
  The shared `AgentRevisionContent` domain value lives in `@opencrane/models/agents`.

- `PrismaPersonalAgentBootstrapRepository(transaction, defaultModelResolver)` and
  `PersonalAgentBootstrapStatuses` — the
  exported app-composition adapter and its ready/denied result. The package-internal
  `PrismaInitialPersonalAgentPublicationRepository` is used only after bootstrap proves that no
  personal service exists.
- `InitialPersonalAgentDefaultModelResolver` and
  `InitialPersonalAgentDefaultModelResolutionStatuses` — the narrow app-provided port and closed
  result vocabulary consumed before initial publication writes anything.

## Boundary

The application mounts the exported Prisma composition and supplies the cross-domain run-admission
port. This package owns its router, caller mapping, database adapters, revision persistence, and
publication-audit wiring. A cross-domain unit of work may bind the model- or persona-selection repository to its
transaction, but personal configuration cannot reproduce its revision projection, Prisma mapping,
or lifecycle. Persona selection never creates an AgentService: no existing personal service is a
documented no-op, while more than one matching service fails closed. The app may likewise construct the personal bootstrap repository with onboarding's
open transaction, but onboarding cannot reproduce AgentService persistence, revision
digests, publication, activation, or publication audit evidence. The bootstrap repository cannot
complete onboarding or commit the transaction. Model-routing owns configured-default precedence and
accessible-definition resolution; the app only translates its result vocabulary into this package's
narrow port. This package does not run agents or resolve
skills/integrations itself. It fails closed:
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
