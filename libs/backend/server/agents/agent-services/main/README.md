# @opencrane/backend/server/agents/agent-services — agent definition plane + management API

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns the **agent definition plane** — the side of OpenCrane that turns a saved
managed or personal agent definition into something the runtime can execute. An *agent service* is the stable identity
of one agent (its name and lifecycle); an *agent revision* is one immutable, versioned snapshot of
how that agent behaves (its prompt policy, registered model definition, budget, skills, and immutable
MCP tool revisions). A service always points at exactly one *active* revision.

This package owns the whole definition plane and the authoritative management API. It creates a
managed service with its first draft revision, accepting only the deployed `managed-default`
workload profile so an admitted service always has an executable controller target. The same
transaction mints the service's durable internal `Principal`, using the reserved
`urn:opencrane:managed-agent` issuer and a deterministic `managed-principal:<AgentService.id>` primary
key; signed fleet membership and generic grants refer to that stored Principal. The package also appends immutable draft revisions as edits (each
recording its parent revision and a change message); restores an older revision by cloning it into
a new revision that records both its parent and its source; publishes a draft (flipping the active
pointer under compare-and-swap); moves the service through enable/pause/retire under optimistic
concurrency; compares any two revisions (line-level prompt diff, semantic config diff, and
security-widening flags); reads run history; and records a run-now admission on the shared run
substrate. Revisions are immutable and form an ordered lineage — an edit never mutates published
history. Each revision carries knowledge boundary attachments using the canonical
`{ boundaryKind, boundaryId, boundaryCoverage }` vocabulary. An attachment narrows knowledge access
to one Group, one stored Group subtree, or one Personal boundary, and never implies skills, Model
Context Protocol tools, models, credentials, or another boundary.

```
 author a draft AgentRevision   (prompt policy · registered model · budget · skills · MCP tools)
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

**In this flow:** [skills](../../skills/main/README.md) · [MCP](../../../gateways/mcp/main/README.md) *(a revision assigns these)*

Invariant: a revision is only published when it belongs to the named service, is still a draft, and
carries every executable field (a positive version, a digest, prompt and registered model definition,
and positive turn/token/duration budgets). Every assigned MCP tool must point to one immutable,
ready tool revision with a non-empty name, valid object input schema, and matching canonical digest.
The model is a foreign-key reference to the
gateway-owned catalogue, so an author cannot turn an arbitrary provider alias into executable
behaviour. A model is available only when it is platform-global or belongs to the service's tenant
scope; the database checks the same rule as the application. The publish and the pointer flip happen
as a single compare-and-swap, so two people publishing at once cannot both win — the second sees a
conflict, and a crash never leaves a half-published service. Anything missing or stale is refused
with a plain reason.

Every management mutation uses the central `AuthorizationAuthority` inside the same database
transaction as its write. Creating, revising, restoring, publishing, and changing lifecycle state
require the caller's current `Organization(siloId) / Administer` grant. Schedule creation instead
checks `Schedule(agentServiceId) / Create`; each schedule item uses its own stable identifier for
`Read`, `Edit`, and `Delete`. The creation transactions seed those exact creator grants, together
with `AgentService / Discover, Read` and immutable `AgentRevision / Read` grants. Attaching
a Group subtree additionally requires a winning grant whose stored boundary coverage includes
descendants; an exact grant cannot widen into subtree access. The HTTP router only authenticates and
passes the durable Principal id. Catalogue, comparison, history, and schedule-list reads are filtered
through the same authority; the router does not make role-based permission decisions.

Run-now is deliberately different from management: it checks the human caller's exact
`AgentService(serviceId) / Invoke` grant in run admission, then separately checks the managed
service Principal's own current invocation grant and signed membership. The immutable run snapshot
freezes the winning decision digests and configured ceilings as evidence, but that evidence is not a
reusable grant. Any later external effect must recheck current authority.
`PrismaRuntimeAgentEffectEligibilityAuthority` performs that effect-time lifecycle check for the app:
the service must still be active and the exact assigned revision must still be its published active
revision.

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
5. Agent-services resolves the trusted onboarding subject to one local Principal. It projects the
   owner's exact service, revision, Persona, and model grants through the shared managed-grant
   repository, then asks the central transaction-bound `AuthorizationAuthority` to admit Persona
   and model use plus service/revision creation and publication.
6. Only after those decisions does the publisher create a `Personal` service in `Draft`, write
   revision 1 through the shared immutable revision writer, publish that revision, and activate the
   service. The onboarding transaction commits grants, central decision evidence, publication, and
   completion together, or none of them.

The initial revision uses the package-owned initial personal-Agent policy and the
`personal-default` runtime profile. Its skills, MCP tools, and knowledge-boundary attachments are
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
        │ validates persona + service eligibility and resolves the local Principal
        ▼
PrismaPersonalAgentProductEffectsAuthority
        │ projects managed grants + records central decisions
        ▼
PrismaInitialPersonalAgentPublicationRepository
        │ consumes model-routing's resolved definition id
        │ writes service + revision + publication
        ▼
ready personal AgentService, or a fail-closed denial
```

## Public surface

- `__CreateAgentServicesRouter` — the authoritative management router (catalogue / create / revise /
  compare / publish / restore / enable / pause / run-now / history / retire); the UI and parity client are
  clients of it. Composed with `AgentServicesRouterDependencies`, `ManagementCaller`, `ManagementClock`.
- `_CreateAgentServicesRouter` — the ready-to-mount Prisma composition. It maps the authenticated
  request principal into `ManagementCaller`, and owns all database adapters,
  and accepts only the shared run-admission port plus the process logger from the app.
- Lifecycle use cases: `__CreateManagedAgentService`, `__ReviseAgentRevision`, `__RestoreAgentRevision`,
  `__ChangeAgentServiceState`, `__CompareAgentRevisions`, `__ReadAgentServiceHistory`, `__AdmitManagedRunNow`.
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
  next revision, and moves the active pointer. Before writing, it projects current owner grants and
  records the AgentService edit, AgentRevision create/publish, and Persona use decisions through the
  shared central authority.
- `AgentRevisionPersonaSelectionMaterializationCodes` — distinguishes a new revision, an
  idempotent already-current revision, a stale source, unavailable authority, and the valid case
  where persona approval finds no personal agent to update.
- `__PublishAgentRevision` — the reused compare-and-swap publish path. Retiring a service clears its
  active-revision pointer in the same database update, so no retired service can still look runnable.
- `ManagedRunAdmissionPort` — the app-owned seam through which run-now AND the scheduler record an
  admission (`trigger: managed_invocation` or `schedule`). `ManagedRunAdmissionOutcomes` is its
  documented serialized outcome vocabulary, so consumers do not recreate accepted, idempotent, or
  denied branch values.
- Schedule plane: `__CreateAgentSchedule`, `__UpdateAgentSchedule`, the shared
  `AgentScheduleOverlapPolicies` vocabulary, and the `/:serviceId/schedules` management surface
  (list/create/update/delete). Evaluation into due runs lives in sibling `scheduling`.
- Boundary attachment admission is part of the lifecycle transaction. The central authority
  evaluates current generic grants, deny precedence, validity, and Group ancestry; an exact allow
  never widens into a descendants attachment.
- Managed execution evidence derives the stored Principal relation from the active managed service,
  verifies its reserved internal origin and current signed fleet membership, intersects the active
  revision's non-personal boundary attachments with effective grants, and returns those coordinates
  and decision digests to the app. It cannot mint an `ExecutionSubject`: the app must also verify a
  Kurrent-backed AgentIdentity and active ConversationComputer lease in the admission fence.
- Run history reads the persisted, strict execution subject with every admitted run and refuses a
  malformed subject or one whose copied identity coordinates disagree; this package does not own the
  participant conversation or its timeline.
- Types: the lifecycle commands/results (`CreateManagedAgentServiceCommand`,
  `ReviseAgentRevisionCommand`, `RestoreAgentRevisionCommand`, `ChangeAgentServiceStateCommand`,
  `ManagedRunNowCommand`, `AgentRevisionLifecycleRepository`, `AgentServiceHistory`, …), the publish
  contract (`PublishAgentRevisionCommand`/`Result`/`FailureReason`,
  `AtomicAgentRevisionPublication*`). The shared `AgentRevisionContent` domain value lives in
  `@opencrane/models/agents`.

- `PrismaPersonalAgentBootstrapRepository(transaction, defaultModelResolver, productEffects)` and
  `PersonalAgentBootstrapStatuses` — the
  exported app-composition adapter and its ready/denied result. The package-internal
  `PrismaInitialPersonalAgentPublicationRepository` is used only after bootstrap proves that no
  personal service exists.
- `PrismaPersonalAgentProductEffectsAuthority` — the transaction-scoped adapter that resolves the trusted
  subject to a local Principal, projects relation-derived grants through the shared managed-grant
  mechanism, and delegates every decision to `AuthorizationAuthority`. It contains no policy
  evaluator of its own.
- `InitialPersonalAgentDefaultModelResolver` and
  `InitialPersonalAgentDefaultModelResolutionStatuses` — the narrow app-provided port and closed
  result vocabulary consumed before initial publication writes anything.

## Boundary

The application mounts the exported Prisma composition and supplies the cross-domain run-admission
port. This package owns its router, caller mapping, database adapters, and revision persistence. The
central authorization admission is the sole publication permission decision and audit source; this
package does not synthesize a second publication authorization record. A cross-domain unit of work may bind the model- or persona-selection repository to its
transaction, but personal configuration cannot reproduce its revision projection, Prisma mapping,
or lifecycle. Persona selection never creates an AgentService: no existing personal service is a
documented no-op, while more than one matching service fails closed. The app may likewise construct the personal bootstrap repository with onboarding's
open transaction, but onboarding cannot reproduce AgentService persistence, revision
digests, publication, activation, or central decision evidence. The bootstrap repository cannot
complete onboarding or commit the transaction. Model-routing owns configured-default precedence and
accessible-definition resolution; the app only translates its result vocabulary into this package's
narrow port. This package does not run agents or resolve
skills or MCP tools itself. It fails closed:
any doubt is a `denied` outcome, never a silent partial publish.

## Database adapters

`src/db/` keeps lifecycle persistence and transaction orchestration separate. The lifecycle
repository reads and writes against a transaction supplied by its caller, while the lifecycle unit
of work opens that serializable transaction and evaluates central authorization before delegating.
The directory also holds the other Prisma repositories, transaction factories, row mappers, and revision writer.
Keeping those details together leaves the package root for domain policies, ports, route assembly,
and process configuration. The router and environment factory compose the adapters; they do not
live in `db/` because they own HTTP and deployment concerns rather than database access.

## Dependency direction

Tagged `scope:agent-services`: it may depend only on `scope:agent-services`, `scope:agents` (shared
agent models), `scope:audit`, `scope:auth`, `scope:authorization`,
`scope:membership`, and `scope:shared` — never on apps, gateways, or knowledge domains. The
`scope:auth` edge resolves only the backend-type-free request principal; run admission remains an
injected port, so this package never imports `scope:execution-runs`. The central authorization edge
is load-bearing: lifecycle attachment admission and managed run admission use the same subject,
boundary, capability, resource, priority, and deny semantics. The grant subject identifies the
receiving Principal or direct-membership Group; its separate Group
or Personal boundary identifies the knowledge target, so a receiver can never be mistaken for the
resource boundary. The membership edge is equally narrow: managed
execution freezes fresh signed service-principal evidence into its immutable snapshot. Boundary
attachments remain silo-bounded and administrator-gated.

## Data & persistence

Owns the `AgentService`, `AgentRevision` (with `parentRevisionId`/`sourceRevisionId`/`changeMessage`
lineage and a required `ModelDefinition` reference), `AgentRevisionBoundaryAttachment`
(`Group` or `Personal`, with exact or stored-descendant coverage), `AgentRevisionSkillAssignment`,
`AgentRevisionMcpToolAssignment`, and `AgentServiceSchedule` (cron, timezone, overlap policy,
enabled, catch-up window) models in `apps/opencrane/prisma/schema/agent-services.prisma`.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [channel-targets](../../channel-targets/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
