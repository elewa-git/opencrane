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
 │   runs  ◄── HERE                          │  run + snapshot + task receipt + ordered outbox
 │   · PrismaRunAdmissionRepository          │  duplicate returns the first snapshot
 │   · AgentRunWorkflowTask                  │  one saved task and receipt per attempt
 │   · RunAdmissionConcurrencyGate            │  bounded wait before a DB connection
 │   · PrismaRunCancellationRepository       │  fence first; clean exact Job; then terminal
 │   · __CreateRuntimeWorkloadCleanupUseCase  │  cleanup policy behind a physical store port
 │   · __StartNextRunAttempt                 │  terminal run: attempt N → N+1
 │   · __ValidateRunWorkloadAssignment       │  Job/Pod identity == current attempt?
 └──────────────────────────────────────────┘
          │  accepted / retry started / assignment trusted / denied
          ▼
 workflow task receipt  ── controller creates a suspended Job ── release ── first Pod registered
```

**In this flow:** [execution/inputs](../../inputs/main/README.md) *(assembles the snapshot through this
package's admission boundary)* · [conversation replay](../../../../server/conversations/main/README.md) *(stores the
run's ordered user-visible events)* · workflow controller *(runs the receipt-bound task and launches the workload)*

Initial admission serialises the silo and request idempotency key before compiling any mutable
input. A duplicate returns the first durable snapshot only when the AgentService, conversation,
trigger, and tagged execution identity are the same. An interactive run proves its delegated
user is that exact subject; a scheduled or explicitly invoked managed run proves the derived service
principal is the active service. A same-silo key from any other authority scope fails closed without
exposing a run. A new request locks the AgentService, lets the session assembler
revalidate every input inside that transaction, and commits the `AgentRun`, its only
`RunInputSnapshot`, one `AgentRunWorkflowTask` with its workflow receipt, and the `RunAccepted`
observer event together.
For an agent-session message, the conversation authority supplies a transaction callback that also
persists that canonical message in this same commit. The canonical digest covers every
snapshot field except its own digest. The persisted snapshot stores revision-selected immutable MCP
tool revisions, including exact input schemas and their digests, as canonical JSON. It stores no
mutable server grant, registry credential, or provider credential.

The transaction-bound conversation input authority rejects a second non-terminal foreground run
before returning a compiled snapshot. The generic run repository passes that typed source denial
through unchanged while continuing to classify only its own same-key replay, authority-conflict, and
unavailable-persistence outcomes. Non-conversation admissions retain their existing silo-global
idempotency semantics.

`RunAdmissionConcurrencyGate` is the upstream overload boundary used by the shared admission
capacity boundary for live personal and managed entrypoints.
It partitions capacity by `(siloId, AgentServiceId)`, starts only the configured number of admissions,
and holds a bounded FIFO queue **before** its work can open a PostgreSQL transaction. A full queue is
rejected with `admission_concurrency_limited`; it does not turn a hot service row lock into an
unbounded connection pool. The production entrypoint must use this gate before calling
`PrismaRunAdmissionRepository.admit()` and must keep its policy aligned with the database pool budget.

`__StartNextRunAttempt` is a **compare-and-swap** retry state machine. The browser supplies the
terminal attempt it actually saw and a fresh retry key; the server supplies the signed-in subject,
host-selected silo, conversation, and run coordinates. The transaction requires current organisation
membership and continuing participation in that exact conversation. It refuses unless the run is in
a retryable terminal state and the service is active with the exact revision the run pins, then
atomically increments the attempt while re-checking every fact — closing the race where two retries
fire at once. In the same transaction it saves and receipt-binds the next attempt's workflow task.
The workflow worker, not an outbox dispatcher, starts that task after the transaction commits. A
replay proves the existing next attempt by its deterministic task key.

`PrismaAgentRunRetryUnitOfWork` keeps that authority behind a persistence-neutral port used by the
conversation package. It opens fresh transactions around the advisory read and the guarded write,
and retries the complete decision at most three times when Prisma proves P2002 or P2034 rolled it
back. After the last collision it reads the committed next-attempt workflow task and accepts it only
when that task has the deterministic key for the next attempt.

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

`PrismaAgentRunWorkflowControllerUnitOfWork` is the database side of the durable AgentRun task. It
checks the task receipt before returning work, records the suspended Job UID, takes the release
lease, and records the first Pod. It mints the attempt-scoped model key only after its database
transaction commits, saves only the key's SHA-256 digest on the workflow task, and revokes a fresh
unused key when the immutable Secret already exists. The bootstrap reference is an opaque label, not
a password: it grants nothing without the exact projected workload identity, assigned Job, and
registered first Pod.

Release uses another recoverable claim lease. The controller unsuspends only the assigned Job, then
returns the first Pod's immutable Kubernetes identifier. This package changes `PendingPod` to
`Registered` and marks the release delivered in one transaction. Replaying the same Pod returns the
recorded answer even after the run or assignment advances to a later lifecycle state; presenting a
different Pod fails permanently. Expired or corrupt authority is failed under the task receipt fence
with a structured reason; its pending assignment is revoked and its run receives the canonical
failure event in the same transaction. Both handshakes use database time and the persisted release
claim to fence a controller whose lease has expired. The assignment and bootstrap also expire no later than the
signed fleet-membership evidence they rely on. That absolute expiry is sealed into the release
record and projected back to the controller, so delayed release cannot restart the full
profile lifetime after some assignment authority has already elapsed.

Cancellation is deliberately two-stage. The request transaction first enters `Cancelling`, revokes
the current assignment and proof key, and closes pending approvals through the authorization domain.
It then records the cancellation intent and cleanup for the receipt-bound workload. A committed
assignment yields an `assigned` cleanup claim
with its immutable Kubernetes UID. If the controller may have created a suspended Job just before
the database fence won, an `unassigned_orphan` claim becomes available only after the controller lease
and request margin; the server-owned cleaner must reconstruct and exactly compare that suspended Job
before it may adopt the API UID for deletion. Its first Kubernetes absence is persisted and deferred
for one additional full create-observation horizon; only a second absence may finalize cancellation.
Only confirmed deletion or authoritative absence moves `Cancelling` to `Cancelled` and emits
`run.cancelled`.

`PrismaRuntimeTerminalReporter` is the matching completion boundary for an authenticated runtime
Pod. It accepts only a protocol-fenced `run.completed` or `run.failed` report for the currently
running attempt, serialises terminal writers on the run, and commits the lifecycle state, canonical
conversation event, and any child-to-parent completion delivery together. The sole pre-start
exception is an exact `compiled_input_coordinate_mismatch` failure bound by the protocol authority
to the accepted `start_attempt` command; it moves that assigned attempt directly to failed instead
of leaving it stranded. Runtime Pods have no `run.cancelled` authority: cancellation continues to
flow through the server-owned cleanup process.

`PrismaToolInvocationRunRecoveryAuthority` is the transaction-bound bridge through which the
authorization domain may change run recovery posture. It compare-and-sets only the exact attempt
from `Running` to `RecoveryRequired`, or back to `Running` after authorization has proved no tool
invocation still needs recovery. A cancelling, cancelled, terminal, or stale attempt is never
overwritten. Its typed enter result distinguishes an already-entered recovery state, cancellation
that safely supersedes the recovery event, and a real authority conflict that must roll back.

Poisoned or expired release authority uses the same generic cleanup event after failing the run, so
physical residue is not confused with user cancellation and a suspended Job is never left for an
inapplicable terminal TTL to discover.

Invariant: a logical run either commits with exactly one digest-sealed snapshot and workflow task
receipt, or does not exist. Retries retain that run and snapshot identity, attempts only move forward
under optimistic concurrency, and any authority, membership, workload, lease, or persistence
uncertainty fails closed.

## Public surface

`PrismaRuntimeEventReporter` is the transaction-scoped admission bridge for runtime output. The
first exact `run.started` proposal is the sole authority that atomically moves the assigned attempt
to `Running` and appends its event; `run.resumed` is accepted only for the still-running attempt.
While a run is `Cancelling`, the reporter accepts only completion or bounded failure evidence from
an already-acquired provider claim; it rejects `tool.started`, so cancellation cannot grant new work.
The reporter rejects arbitrary names, oversized payloads, secret-shaped fields, stale attempts, and
mis-bound A2UI envelopes before appending a contiguous canonical `ConversationRunEvent`. Each event
also has an exact key and value vocabulary, so a compromised runtime cannot persist provider text or
credential material under an innocuous field name such as `detail`.

- `__DigestRunInputSnapshot(snapshot)` — compute the canonical SHA-256 identity of all frozen run
  inputs without digesting the self-referential `digest` field.
- `PrismaRunAdmissionRepository` — serialise duplicate requests and atomically persist the initial
  run, snapshot, workflow task receipt, and ordered outbox events around a caller-supplied assembly
  callback.
- `RunAdmissionConcurrencyGate` — bound active and queued admissions for one silo and AgentService
  before the caller can acquire a persistence connection.
- `RunAdmissionRepository`, `RunAdmissionCommand`, `RunAdmissionTransaction`,
  `RunAdmissionBuildResult` and `RunAdmissionResult` — the transaction-fenced initial-admission port
  and its input/output vocabulary.
- `PrismaAgentRunWorkflowControllerUnitOfWork` — serves the controller-hosted durable task with
  receipt-fenced run state, transient model keys, Job bindings, release leases, and observations.
- `AttemptModelKeyIssuer`, `AttemptModelKeyMintRequest`, and `MintedAttemptModelKey` — the narrow
  app-owned model-key minting port and its transient request/result contract.
- `PrismaRunCancellationRepository` — atomically fence one exact attempt, issue assigned or delayed
  orphan cleanup authority, lease that cleanup, and finalise cancellation only after confirmation.
- `__CreateRuntimeWorkloadCleanupUseCase` — claim one cleanup event, apply the two-observation
  orphan-absence policy, and confirm authoritative absence through a physical store port.
- `__CreateAgentRunWorkflowControllerRouter` — projected-token-authenticated internal API for the
  fixed `agent-controller` ServiceAccount running an admitted AgentRun task.
- `_CreateSelfRunStatusRouter` — the ready-to-mount Prisma composition that maps the shared request
  principal into the self-run caller and supplies the status repository.
- `_CreateSelfRunCancellationRouter` — the ready-to-mount owner-only cancellation route. It derives
  silo and subject from the session, hides foreign runs, and passes only the browser-observed attempt
  to the shared durable cancellation authority.
- `PrismaRuntimeTerminalReporter` — commits a protocol-approved terminal result through the run
  authority.
- `PrismaAgentRunRetryUnitOfWork` and `RunRetryAuthority` — compose participant run retry without
  exposing a root Prisma client or transaction repository to the conversation package.
- `PrismaToolInvocationRunRecoveryAuthority` — changes only the exact run attempt's recovery state
  inside the authorization-owned invocation transaction.
- `_SelfRunStatusOpenapiPaths` — contributes the self-run status contract to the server API spec.

Retry, child-run, cleanup, and status support types remain package-private.
They can evolve with their owning implementations without becoming cross-package contracts.

## Boundary

Consumed by the [execution input assembler](../../inputs/main/README.md), workflow admission,
cancellation, and cleanup-authority paths. It does not choose persona, memory, tools,
budgets or membership evidence; the input assembler supplies those through the transaction callback. It does
not run the agent, create/unsuspend the Job, or expose the private input snapshot to the
controller. It does not treat the bootstrap reference as a credential and does not inspect
Kubernetes itself. It owns only durable admission, attempts, task receipts, assignment integrity,
release delivery, first-Pod registration, cancellation fencing, and cleanup
confirmation. Kubernetes inspection and mutation remain in the dedicated
[runtime cleanup adapter](../../../runtime/cleanup/main/README.md). The use case in this package
decides when physical evidence may defer or confirm durable cleanup; it never sees a Kubernetes
client or object.

Child admission is not an alternate public run-start route. Interactive root runs can start only
from the participant-owned agent-session message API; the old public `POST /api/v1/me/runs` route no
longer exists. A child-run caller must derive parent authority
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

Owns `AgentRun`, its one `RunInputSnapshot`, `AgentRunWorkflowTask`, and run-domain outbox rows in
`apps/opencrane/prisma/schema/runs.prisma`. Initial admission commits the run, snapshot, saved
workflow task receipt, and `RunAccepted` observer event together. An optional caller-owned commit
hook lets the conversation authority add the participant's input message without opening a second
transaction; it cannot replace or weaken run-owned validation. Later retries atomically advance the
attempt counter and save the next workflow task receipt. The task receipt fences controller-created
`WorkloadAssignment` and `WorkloadBootstrap` records before the controller releases its Job.
Cancellation reuses the same outbox with `RunCancellationRequested` and
`RunWorkloadCleanupRequested`; no second cleanup queue or revocation authority exists.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [inputs](../../inputs/main/README.md) · [runtime cleanup](../../../runtime/cleanup/main/README.md) · [conversation replay](../../../../server/conversations/main/README.md) · [agent memory](../../../memory/main/README.md) · [personal-memory selection](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
