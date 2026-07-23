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
 │   · __StartNextRunAttempt                 │  terminal run: attempt N → N+1
 │   · __ValidateRunWorkloadAssignment       │  Job/Pod identity == current attempt?
 └──────────────────────────────────────────┘
          │  accepted / retry started / assignment trusted / denied
          ▼
 run-owned outbox  ── controller claims it ── suspended Job ── release ── first Pod registered
```

**In this flow:** [execution/inputs](../../inputs/main/README.md) *(assembles the snapshot through this
package's admission boundary)* · [conversations](../../../personal/conversations/main/README.md) *(stores the
run's ordered user-visible events)* · dispatcher *(polls the outbox and launches the workload)*

Initial admission serialises the silo and request idempotency key before compiling any mutable
input. A duplicate returns the first durable snapshot only when the AgentService, conversation
thread and signed execution subject are the same; an interactive run also proves that its delegated
user is that exact subject. A same-silo key from any other authority scope fails closed without
exposing a run. A new request locks the AgentService, lets the session assembler
revalidate every input inside that transaction, and commits the `AgentRun`, its only `RunInputSnapshot`, and the ordered
`RunAccepted` and `RunAttemptRequested` outbox events together. The canonical digest covers every
snapshot field except its own digest.

`RunAdmissionConcurrencyGate` is the upstream overload boundary for a live admission entrypoint.
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
Job, confirms the workload's full identity (who / where / which attempt) matches the expected authority exactly, uses the fixed
`opencrane-agent-runtime` projected-token audience, and has not expired.

`PrismaRunDispatchRepository` is the database side of the controller handshake. It issues a short,
server-owned claim lease over `RunAttemptRequested`, exposes only the coordinates needed to create a
suspended Job, and commits the Job UID as a `PendingPod` assignment. At claim time it also mints the
attempt-scoped model key through an injected `AttemptModelKeyIssuer` (the app binds this to the
model-routing gateway, which holds the LiteLLM master key) using the alias and budget frozen on the
snapshot, and attaches the transient virtual key to the claim response only — it is never written to
Postgres. Minting happens outside the database transaction so no external call holds a lock. That commit also creates an
unconsumed bootstrap record and a second durable command asking the controller to release the Job.
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
and request margin; the cleaner must reconstruct and exactly compare that suspended Job before it
may adopt the API UID for deletion. If no controller claim ever left Postgres, the locked failed
attempt event proves no Job can exist and cancellation can finish immediately. Only confirmed
deletion or authoritative absence moves `Cancelling` to `Cancelled` and emits `run.cancelled`.

Poisoned or expired release authority uses the same generic cleanup event after failing the run, so
physical residue is not confused with user cancellation and a suspended Job is never left for an
inapplicable terminal TTL to discover.

Invariant: a logical run either commits with exactly one digest-sealed snapshot and its dispatch
event, or does not exist. Retries retain that run and snapshot identity, attempts only move forward
under optimistic concurrency, and any authority, membership, workload, lease, or persistence
uncertainty fails closed.

## Public surface

- `__StartNextRunAttempt(repository, command)` — start the next attempt of a run via compare-and-swap.
- `__ValidateRunWorkloadAssignment(assignment, expectation)` — confirm a workload is the one authorised for this attempt.
- `__DigestRunInputSnapshot(snapshot)` — compute the canonical SHA-256 identity of all frozen run
  inputs without digesting the self-referential `digest` field.
- `PrismaRunAdmissionRepository` — serialise duplicate requests and atomically persist the initial
  run, snapshot and ordered outbox events around a caller-supplied assembly callback.
- `RunAdmissionConcurrencyGate` — bound active and queued admissions for one silo and AgentService
  before the caller can acquire a persistence connection.
- `RunAdmissionRepository`, `RunAdmissionCommand`, `RunAdmissionTransaction`,
  `RunAdmissionBuildResult` and `RunAdmissionResult` — the transaction-fenced initial-admission port
  and its input/output vocabulary.
- `PrismaAgentRunAuthorityRepository` — the Prisma-backed adapter implementing the persistence port (atomic retry + outbox append).
- `PrismaRunDispatchRepository` — claim an attempt, commit its suspended Job and bootstrap, then
  claim release work and register exactly one first Pod.
- `PrismaRunCancellationRepository` — atomically fence one exact attempt, issue assigned or delayed
  orphan cleanup authority, lease that cleanup, and finalise cancellation only after confirmation.
- `RequestRunCancellation*`, `RunWorkloadCleanup*`, and `ConfirmRunWorkloadCleanup*` — the typed
  lifecycle, lease, server-derived Job projection, and physical-evidence outcomes.
- `__CreateAgentControllerRunDispatchRouter` — projected-token-authenticated internal assignment and
  release API for the fixed `agent-controller` ServiceAccount.
- `RunDispatchRepository` / `AgentControllerTokenReviewer` — persistence and TokenReview ports used by that internal API.
- `ClaimNextRunWorkloadReleaseResult` / `RegisterRunWorkloadPodResult` — release-claim and first-Pod
  registration outcomes used across the internal adapter boundary.
- `AgentRunAuthorityRepository` / `AgentRunAuthoritySnapshot` — the persistence port and its consistent read shape.
- `StartNextRunAttemptCommand` / `StartNextRunAttemptResult`, `AtomicStartNextRunAttemptCommand` / `AtomicRunAttemptResult` — retry request/result and their atomic commit forms.
- `RunWorkloadAssignment` / `RunWorkloadAssignmentExpectation` / `RunWorkloadAssignmentDecision` — the workload-identity check inputs and verdict.

## Boundary

Consumed by the [execution input assembler](../../inputs/main/README.md), run-dispatch and workload-
admission, cancellation, and cleanup-authority paths. It does not choose persona, memory, tools,
budgets or membership evidence; the input assembler supplies those through the transaction callback. It does
not run the agent, create/unsuspend the Job, or expose the private input snapshot to the
controller. It does not treat the bootstrap reference as a credential and does not inspect
Kubernetes itself. It owns only durable admission, attempts, dispatch leases, assignment
integrity, release delivery, first-Pod registration, cancellation fencing, and cleanup
confirmation. Kubernetes inspection and mutation remain in dedicated runtime processes; this
package only says which exact work may be removed.

## Dependency direction

Tagged `scope:execution-runs`: it may depend only on `scope:agents` (shared run models),
`scope:authorization`, `scope:execution-runs`, and `scope:shared` — never on apps or sibling domains.

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
- Siblings: [inputs](../../inputs/main/README.md) · [conversations](../../../personal/conversations/main/README.md) · [memory](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
