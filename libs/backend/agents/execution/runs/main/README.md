# @opencrane/backend/agents/execution/runs — agent-run attempt authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › runs

## What it owns

This package is part of the **shared execution flow** used by both personal and managed agents. A
**run** is one logical execution of an agent, while an **attempt** is one try at completing that run.
This package owns both ends of that lifecycle: it admits the first run together with the immutable
input snapshot it will always use, then governs later attempts without changing the logical run or
its frozen inputs.

```
 run request + idempotency key
          │  execution/inputs assembles inputs inside this package's transaction
          ▼
 ┌──────────────────────────────────────────┐
 │   runs  ◄── HERE                          │  run + one snapshot + ordered outbox
 │   · PrismaRunAdmissionRepository          │  duplicate returns the first snapshot
 │   · RunAdmissionConcurrencyGate            │  bounded wait before a DB connection
 │   · PrismaRunCancellationRepository       │  fence first; clean exact Job; then terminal
 │   · __CreateRuntimeWorkloadCleanupUseCase  │  cleanup policy behind a physical store port
 │   · __StartNextRunAttempt                 │  terminal run: attempt N → N+1
 │   · __ValidateRunWorkloadAssignment       │  Job/Pod identity == current attempt?
 └──────────────────────────────────────────┘
          │  accepted / retry started / assignment trusted / denied
          ▼
 run-owned outbox  ── controller claims it ── suspended Job ── release ── first Pod registered
```

**In this flow:** [execution/inputs](../../inputs/main/README.md) *(assembles the snapshot through this
package's admission boundary)* · [conversation replay](../../../../server/agents/conversation-replay/main/README.md) *(stores the
run's ordered user-visible events)* · dispatcher *(polls the outbox and launches the workload)*

Initial admission serialises the silo and request idempotency key before compiling any mutable
input. A duplicate returns the first durable snapshot only when the AgentService, conversation
thread, trigger, and tagged execution identity are the same. An interactive run proves its delegated
user is that exact subject; a scheduled or explicitly invoked managed run proves the derived service
principal is the active service. A same-silo key from any other authority scope fails closed without
exposing a run. A new request locks the AgentService, lets the session assembler
revalidate every input inside that transaction, and commits the `AgentRun`, its only `RunInputSnapshot`, and the ordered
`RunAccepted` and `RunAttemptRequested` outbox events together. The canonical digest covers every
snapshot field except its own digest. The persisted snapshot stores revision-selected integration
tool assignments as canonical JSON, not a mutable MCP-server grant or a custody reference; custody
is rechecked only when an action is actually attempted.

`RunAdmissionConcurrencyGate` is the upstream overload boundary used by the shared admission
capacity boundary for live personal and managed entrypoints.
It partitions capacity by `(siloId, AgentServiceId)`, starts only the configured number of admissions,
and holds a bounded FIFO queue **before** its work can open a PostgreSQL transaction. A full queue is
rejected with `admission_concurrency_limited`; it does not turn a hot service row lock into an
unbounded connection pool. The production entrypoint must use this gate before calling
`PrismaRunAdmissionRepository.admit()` and must keep its policy aligned with the database pool budget.

`__StartNextRunAttempt` is a **compare-and-swap** retry state machine: it reads the run and its
AgentService authority as one snapshot, refuses unless the run is in a retryable terminal state and the
service is active with the exact revision the run pins, then atomically increments the attempt while
re-checking every one of those facts — closing the race where two retries fire at once. In the same
transaction it appends a `RunAttemptRequested` event to the **outbox** (a durable table the dispatcher
polls) so a started attempt can never be lost between deciding and launching.

`__ValidateRunWorkloadAssignment` is the mirror check at launch time: it accepts only a one-attempt
Job, confirms the workload's full identity (who / where / which attempt) matches the expected authority exactly, and selects the dedicated personal or managed namespace together with its matching projected-token audience and ServiceAccount grammar.

`__PrepareChildRunAdmission` is the authority-only first step for an agent asking a parent run to
start another agent. It inherits the silo, subject and run lineage exclusively from the already
admitted parent; the child request cannot supply replacements. Before returning a prepared record it
enforces server-owned depth, direct-child and remaining-budget limits, then calls the supplied
delegation policy for the exact target service and immutable revision. It returns a plain denial for
any failed check. A later persistence adapter must repeat the target check and reserve the budget in
the same transaction that creates the child run: this pure package intentionally makes no durable
reservation on its own.

`ChildRunReservation` is the durable companion record for that later transaction. It fixes a
child's exact parent/root lineage, depth, token allocation, and micro-USD cost allocation. The
database accepts it only for an accepted first attempt whose existing `AgentRun` already has that
same lineage and silo, locks the parent while checking it, and rejects every subsequent change.
The later transaction will calculate remaining capacity from these append-only records rather than
from a mutable counter or a value supplied by the requesting agent.

`PrismaRunDispatchRepository` is the database side of the controller handshake. It issues a short,
server-owned claim lease over `RunAttemptRequested`, exposes only the coordinates needed to create a
suspended Job, and commits the Job UID as a `PendingPod` assignment. At claim time it also mints the
attempt-scoped model key through an injected `AttemptModelKeyIssuer` (the app binds this to the
model-routing gateway, which holds the LiteLLM master key) using the alias and budget frozen on the
snapshot, and attaches the transient virtual key to the claim response only — it is never written to
Postgres. Minting happens outside the database transaction so no external call holds a lock. That commit also creates an
unconsumed bootstrap record and a second durable command asking the controller to release the Job.
The package-private credential-minting seam derives both model and optional Obot requests from the
locked immutable snapshot, then performs both provider calls only after the claim transaction has
committed; the public repository remains the single controller-facing facade.
The bootstrap reference is an opaque label, not a password: it grants nothing without the exact
projected workload identity, assigned Job and registered first Pod. The stored integrity digest binds
the label to every immutable assignment field, including the selected workload profile.

Delivered runtime commands are short-lived operational handshakes, not the permanent run audit. The
controller periodically asks this repository to delete only old, successfully published records in a
small database transaction. Failed commands remain intact for diagnosis, and the target-schema trigger
rejects every direct delete outside that dedicated transaction.

Release uses another recoverable claim lease. The controller unsuspends only the assigned Job, then
returns the first Pod's immutable Kubernetes identifier. This package changes `PendingPod` to
`Registered` and marks the release delivered in one transaction. Replaying the same Pod returns the
recorded answer even after the run or assignment advances to a later lifecycle state; presenting a
different Pod fails permanently. The oldest release row is selected even when its assignment or
bootstrap has expired, then classified under locks rather than returned as claimable work. Expired
or corrupt authority is failed under its exact outbox fence with a structured reason; its pending
assignment is revoked and its run receives the canonical failure
event in the same transaction, so the next poll can continue to newer work without stranding the old
run. After that transaction commits, the HTTP boundary emits one structured warning and retains the
normal empty-poll response, so operators see the repair without making the controller treat it as an
API outage. Both handshakes use database time and the exact `claimedAt` plus `deliveryCount` pair to fence a
controller whose lease has expired. The assignment and bootstrap also expire no later than the
signed fleet-membership evidence they rely on. That absolute expiry is sealed into the release
outbox payload and projected back to the controller, so delayed release cannot restart the full
profile lifetime after some assignment authority has already elapsed.

Cancellation is deliberately two-stage. The request transaction first enters `Cancelling`, revokes
the current assignment and proof key, closes pending approvals through the authorization domain,
and fails any unpublished dispatch or release command. It then records both the cancellation intent
and any physical cleanup still required. A committed assignment yields an `assigned` cleanup claim
with its immutable Kubernetes UID. If the controller may have created a suspended Job just before
the database fence won, an `unassigned_orphan` claim becomes available only after the dispatch lease
and request margin; the server-owned cleaner must reconstruct and exactly compare that suspended Job
before it may adopt the API UID for deletion. Its first Kubernetes absence is persisted and deferred
for one additional full create-observation horizon; only a second absence may finalize cancellation.
If no controller claim ever left Postgres, the locked failed
attempt event proves no Job can exist and cancellation can finish immediately. Only confirmed
deletion or authoritative absence moves `Cancelling` to `Cancelled` and emits `run.cancelled`.

`PrismaRuntimeTerminalReporter` is the matching completion boundary for an authenticated runtime
Pod. It accepts only a protocol-fenced `run.completed` or `run.failed` report for the currently
running attempt, serialises terminal writers on the run, and commits the lifecycle state, canonical
conversation event, and any child-to-parent completion delivery together. Runtime Pods have no
`run.cancelled` authority: cancellation continues to flow through the server-owned cleanup process.

Poisoned or expired release authority uses the same generic cleanup event after failing the run, so
physical residue is not confused with user cancellation and a suspended Job is never left for an
inapplicable terminal TTL to discover.

Invariant: a logical run either commits with exactly one digest-sealed snapshot and its dispatch
event, or does not exist. Retries retain that run and snapshot identity, attempts only move forward
under optimistic concurrency, and any authority, membership, workload, lease, or persistence
uncertainty fails closed.

## Public surface

- `__DigestRunInputSnapshot(snapshot)` — compute the canonical SHA-256 identity of all frozen run
  inputs without digesting the self-referential `digest` field.
- `PrismaRunAdmissionRepository` — serialise duplicate requests and atomically persist the initial
  run, snapshot and ordered outbox events around a caller-supplied assembly callback.
- `RunAdmissionConcurrencyGate` — bound active and queued admissions for one silo and AgentService
  before the caller can acquire a persistence connection.
- `RunAdmissionRepository`, `RunAdmissionCommand`, `RunAdmissionTransaction`,
  `RunAdmissionBuildResult` and `RunAdmissionResult` — the transaction-fenced initial-admission port
  and its input/output vocabulary.
- `PrismaRunDispatchRepository` — claim an attempt, commit its suspended Job and bootstrap, then
  claim release work and register exactly one first Pod.
- `AttemptModelKeyIssuer`, `AttemptModelKeyMintRequest`, and `MintedAttemptModelKey` — the narrow
  app-owned model-key minting port and its transient request/result contract.
- `PrismaRunCancellationRepository` — atomically fence one exact attempt, issue assigned or delayed
  orphan cleanup authority, lease that cleanup, and finalise cancellation only after confirmation.
- `__CreateRuntimeWorkloadCleanupUseCase` — claim one cleanup event, apply the two-observation
  orphan-absence policy, and confirm authoritative absence through a physical store port.
- `__CreateAgentControllerRunDispatchRouter` — projected-token-authenticated internal assignment and
  release API for the fixed `agent-controller` ServiceAccount.
- `_CreateSelfRunStatusRouter` — the ready-to-mount Prisma composition that maps the shared request
  principal into the self-run caller and supplies the status repository.
- `PrismaRuntimeTerminalReporter` — commits a protocol-approved terminal result through the run
  authority.
- `_SelfRunStatusOpenapiPaths` — contributes the self-run status contract to the server API spec.

Retry, child-run, cancellation, cleanup, status, and dispatch support types remain package-private.
They can evolve with their owning implementations without becoming cross-package contracts.

## Boundary

Consumed by the [execution input assembler](../../inputs/main/README.md), run-dispatch and workload-
admission, cancellation, and cleanup-authority paths. It does not choose persona, memory, tools,
budgets or membership evidence; the input assembler supplies those through the transaction callback. It does
not run the agent, create/unsuspend the Job, or expose the private input snapshot to the
controller. It does not treat the bootstrap reference as a credential and does not inspect
Kubernetes itself. It owns only durable admission, attempts, dispatch leases, assignment
integrity, release delivery, first-Pod registration, cancellation fencing, and cleanup
confirmation. Kubernetes inspection and mutation remain in the dedicated
[runtime cleanup adapter](../../../runtime/cleanup/main/README.md). The use case in this package
decides when physical evidence may defer or confirm durable cleanup; it never sees a Kubernetes
client or object.

Child admission is not an alternate public run-start route. A caller must derive parent authority
from the admitted parent run, use the target-authorization port backed by that parent's approved
tool policy, and persist the prepared record through a transaction that rechecks and reserves it.
This package neither trusts a child-supplied subject, silo or lineage nor creates a child run by
itself.

The reservation repository is the sole durable child-admission boundary. It derives parent facts
from locked database rows and the parent snapshot, rechecks the target policy, and records the
derived depth with the child allocation. Replaying the same inherited-silo idempotency key returns
only the exact sealed child; any coordinate mismatch fails closed.

Completion delivery is a separate, child-keyed ledger rather than an in-memory callback. It locks
the terminal child, its reservation, and the parent event stream before adding a single
`child.run.*` event. A duplicate report returns the existing ledger result. A parent without a
conversation stream, or a parent that has already terminalised, is recorded as a deliberate
suppressed outcome instead of silently losing the result or violating the event-stream fence.

## Dependency direction

Tagged `scope:execution-runs`: it may depend only on `scope:agents` (shared run models),
`scope:auth`, `scope:authorization`, `scope:execution-runs`, and `scope:shared` — never on apps or
sibling domains. The auth edge is limited to backend-type-free request-principal resolution.

## Data & persistence

Owns `AgentRun`, its one `RunInputSnapshot`, and run-domain outbox rows in
`apps/opencrane/prisma/schema/runs.prisma`. Initial admission commits the run, snapshot,
`RunAccepted`, and first `RunAttemptRequested` event together; later retries atomically advance the
attempt counter and append another `RunAttemptRequested` event. Dispatch leases that event, persists
the immutable `WorkloadAssignment` and `WorkloadBootstrap`, advances the run to `Assigned`, appends
one `RunWorkloadReleaseRequested` event for that attempt, and publishes only the attempt event in one
transaction. First-Pod registration publishes the release event atomically, leaving no gap where a
Pod is trusted but its release command can be reclaimed.
Cancellation reuses the same outbox with `RunCancellationRequested` and
`RunWorkloadCleanupRequested`; no second cleanup queue or revocation authority exists.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [inputs](../../inputs/main/README.md) · [runtime cleanup](../../../runtime/cleanup/main/README.md) · [conversation replay](../../../../server/agents/conversation-replay/main/README.md) · [agent memory](../../../memory/main/README.md) · [personal-memory selection](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
