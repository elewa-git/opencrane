# @opencrane/backend/server/agents/scheduling — conversational routines

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › [scheduling](../README.md) › main

## What it owns

This package owns reviewed conversational routines for managed agents. A person creates a routine
from an existing readable conversation, chooses one managed agent and confirms an exact subset of
the current participants. That destination, agent and audience stay fixed. Later revisions replace only the
schedule and encrypted instruction.

```text
 reviewed human command
          │ current grants, destination participants and managed agent
          ▼
 ┌──────────────────────────────────────────────┐
 │ scheduling ◄── HERE                         │
 │ immutable revisions + durable firing owner  │
 └──────────────────────────────────────────────┘
          │ occurrence conversation + saved preparation receipts
          ▼
shared root-run admission → managed-agent execution
```

**In this flow:** [conversations](../../../conversations/main/README.md) owns participant history and
occurrence creation · [agent-services](../../agent-services/main/README.md) owns managed-agent
publication · [workflow contract](../../../infra/workflows/contract/README.md) owns durable task execution ·
[root-run admission](../../../../agents/execution/runs/main/README.md) owns the admitted AgentRun ·
[execution inputs](../../../../agents/execution/inputs/main/README.md) assemble its frozen snapshot.

The package stores no plaintext instruction. Server composition supplies the mounted AES-GCM
cipher, transaction-bound product authorization, product-owned grant projection, durable workflow
task admission, occurrence preparation, computer activation and shared root-run admission ports.
Encryption and external preparation run outside replayed database transactions.

Each automatic or manual firing reserves a new occurrence conversation. Automatic recovery selects
only the latest due slot between the saved cursor and the database clock. An unfinished firing makes
that slot an explicit overlap skip, and the cursor still advances. A manual command may run while a
routine is active or paused and never changes the automatic cursor.

## State and event contract

The public lifecycle table is exhaustive. `Proceed` still requires the original requester, current
central authorization and an atomic compare-and-set. `NoOp` does not grant permission or write.

| Current state | Revise | Pause | Resume | Retire | Run now | Automatic wake |
| --- | --- | --- | --- | --- | --- | --- |
| Active | Proceed → Active | Proceed → Paused | NoOp | Proceed → Retired | Proceed | Proceed |
| Paused | Proceed → Paused | NoOp | Proceed → Active | Proceed → Retired | Proceed | NoOp |
| Retired | NoOp | NoOp | NoOp | NoOp | Refuse | NoOp |

Firing progress is separate. `Preparing`, `Running`, `Waiting` and `Uncertain` are unfinished and
block automatic overlap. `Uncertain` preserves its saved provider evidence and can resolve only to
`Running`, `Completed`, `Failed` or `Cancelled` when the linked `AgentRun` supplies the matching
outcome. Its first result/effect reference remains unchanged through every later transition; the
linked `AgentRun` owns the latest execution outcome. The future run-result adapter that reports those transitions is typed here but is not wired
by this package.

Before preparation, every activation poll and run admission, the workflow opens a fresh transaction
and rechecks lifecycle, every fixed audience member, both current effect grants and the selected
managed service. A pending activation sleeps durably until its next bounded poll instead of failing
the workflow attempt. The firing keeps the immutable instruction and audience revision selected when
it was created, even if a later edit publishes another routine revision. A denial moves an
unadmitted firing to `Refused` and retains any earlier stage receipts.
The external adapters must repeat the relevant check at their authoritative write because a database
check cannot remain atomic with later external I/O.

Effect admissions keep the original requester as the entitled Principal while recording the actor
that actually caused the stage. A manual firing records the saved human command as a `user` actor;
an automatic firing records the stable routine-scheduler `system` actor. Stage rechecks derive that
actor from the persisted trigger rather than accepting it from a worker request.

## Public surface

- `RoutineAuthority` validates commands, encrypts instructions and invokes transactional
  persistence. Authorized reads decrypt only after their read transaction completes.
- `PrismaRoutineUnitOfWork` opens bounded Serializable transactions and constructs the facts,
  command and firing repositories from the exact transaction callback.
- `RoutineScheduleStartupRecovery` consumes the typed `RoutineScheduleRepairPage` contract to
  repair all active schedule heads through stable cursor pages; each page returns `{checked,
  nextCursor}` and a full page must provide continuation.
- `PrismaRoutineOccurrencePreparationRepository` adopts the conversation owner's transaction so
  authority, final audience grants and the immutable preparation marker commit together. App
  composition injects it through the narrow scheduling-contract factory.
- `PrismaRoutineOccurrenceActivationRepository` adopts the computer owner's transaction, matches
  the exact saved preparation and repeats current activation authority before first activation or
  receipt recovery. It records or refuses only an unadmitted preparing firing.
- `PrismaRoutineOccurrenceRunAdmissionRepository` is the final transaction-bound run fence: it
  matches the immutable command and both stage receipts, then rechecks current authority. A denial
  can mark only a preparing, unadmitted firing as `Refused`; this fence admits the root run but never
  claims or starts runnable work.
- `RoutineInstructionCipherAdapter` binds encrypted instructions to the silo, destination,
  requester and immutable routine revision. Composition supplies the existing mounted payload
  cipher; this package neither loads keys nor implements another encryption algorithm.
- `RoutineTaskAdmission` submits validated schedule and occurrence inputs through the guarded
  workflow engine using the caller's transaction. Composition must register the task declarations
  and queue policies first. The adapter does not start workers or choose queues.
- `__CreateRoutineWorkflowDefinitions` provides the durable schedule and occurrence handlers.
- `RoutineInstructionCipher` and `RoutineTaskAdmissionPort` are the package's local composition
  contracts. The separate [scheduling contract](../contract/README.md) owns the occurrence
  preparation, computer activation and root-run admission ports and validated receipts.
- `RoutineLifecycleEvent` and `__DecideRoutineLifecycle` expose the state/event decision table.

## Boundary

Creation needs an explicit current `RoutineCollection Create` grant. The command carries the exact
creator-confirmed Principal list; the transaction verifies only that list against current external
destination participants and their Read grants. It never adds a participant who joined after review.
The transaction verifies the current
published managed service and projects product-owned grants: the creator receives Read, Edit, Use
and Retire; each confirmed audience member receives Read in that recipient's Personal boundary.

Active and paused reads require every frozen audience member to retain destination participation
and both destination and routine Read. A retired routine instead exposes retained history only to a
caller in the original frozen audience who still has current destination participation,
Conversation Read and Routine Read; another former audience member losing access does not hide that
history. Retirement restricts the product-owned grant set to existing unrevoked Read grants for that
original audience. It neither creates a missing or previously revoked Read grant nor adds a later
participant, and it removes Edit, Use and Retire grants, including future-dated grants. Retained
Read grants keep their validity dates and still need to be effective when the reader requests access.

Updates, pause, resume, retire and run-now additionally require the exact original requester. Every
firing rechecks all fixed audience members, current managed-agent authority, Routine Use and
AgentService Invoke. Retired routines cannot be revised or fired. A snapshot, saved status or
ownership flag never substitutes for current authorization.

## Dependency direction

The app composition root injects transaction-bound authorization, managed-grant and workflow-task
ports. This package depends on the scheduling and workflow contracts and product models, but never imports a
conversation, runtime, scheduler-engine or mounted-cipher implementation. Conversation preparation,
computer activation and run admission remain injected ports.
The instruction adapter accepts a structural payload-cipher port, so the existing conversation
cipher can be injected without a dependency on its implementation package. Its purpose-prefixed
payload reference binds the routine identifier and revision separately from ordinary chat payloads.

## Durability and recovery

Requester command receipts bind the caller, command kind, idempotency key and normalized command
digest. Exact retries return the first committed result only after its complete saved shape, enum
values, revisions, identifiers and timestamps pass strict validation. A key reused with different
arguments is rejected after current authority is rechecked. Automatic slots use a separate exact
firing key.

Schedule task keys include the silo, routine, revision and automatic slot. Occurrence task keys use
the silo and immutable firing identifier. JSON tuple encoding prevents delimiter collisions, and
the workflow engine keeps the two task names separate. Admission failures propagate to the product
transaction; the adapter never retries after that transaction ends.

Schedule and occurrence tasks are admitted inside the product transaction. Restart repair re-admits
silo-scoped active schedule heads in stable, bounded cursor pages, with one serializable transaction
per page and their existing keys; an empty page after a full page is a normal exhausted result.
Occurrence preparation and computer
activation each save an immutable receipt before the next external step. Computer activation may
return a bounded pending result; the workflow uses a deterministic checkpoint for each poll, repeats
current activation authority outside that checkpoint and sleeps no later than the reported expiry.
Replayed checkpoint and database receipts must contain nonblank references and an exact SHA-256
digest, with no converted or discarded fields. Conversation publication first asks the scheduling-owned repository to match every
immutable occurrence coordinate and repeat current authority. An existing exact marker is recovered
without recreating grants; a first marker is saved under a no-run compare-and-set in the same caller-owned
transaction as publication. Computer activation uses the same pattern but never bypasses a fresh
authority check when it recovers a saved activation receipt. Shared run admission must create the root `AgentRun` and set the firing backlink in
the same transaction; this package then validates that exact link before moving the firing to
`Running`.

## Data and persistence

`AgentRoutine` stores stable provenance, lifecycle and the automatic cursor. Immutable
`AgentRoutineRevision` rows store schedule, fixed audience and the AES-GCM envelope.
`AgentRoutineFiring` stores one occurrence, task fence, preparation receipts, admitted run and result
evidence. `AgentRoutineCommandReceipt` owns requester-command replay. PostgreSQL constraints and
deferred commit checks enforce the same aggregate invariants beneath Prisma.

## See also

- [Scheduling packages](../README.md)
- [Occurrence hand-off contract](../contract/README.md)
- [Managed-agent server capabilities](../../README.md)
- [Conversation authority](../../../conversations/main/README.md)
- [Prisma unit-of-work envelope](../../../infra/prisma-unit-of-work/README.md)
