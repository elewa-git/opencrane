# @opencrane/backend/agents/execution/runs — agent-run authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › runs

## What it owns

A **run** is one request for an agent to do work. An **attempt** is one try at finishing that run.
This package admits personal and company-assistant conversation runs and freezes their fixed input in one database transaction.
For a new personal run, that transaction also grants its verified owner permission to read its activity.
The active conversation-computer lease and its Sandbox claim are independently proven inputs; the
transaction does not create or claim that runtime. Conversation activation admits one Absurd task,
and the admitted run stores the exact task receipt allowed to advance it.

```text
 request
   │
   ▼
 ┌────────────────────────────────────────────────────────────┐
 │ runs package  ◄── HERE                                     │
 │ admit run + freeze fixed input in one database transaction│
 └────────────────────────────────────────────────────────────┘
   │
   ▼
 Absurd resumes the server-owned turn under the saved run receipt
   │
   ▼
 agent works → server saves events → lifecycle settles the governed workload
```

**In this flow:** [input assembler](../../inputs/main/README.md) · [conversation authority](../../../../server/conversations/main/README.md) · [runtime controller](../../../runtime/controller/README.md)

The server is always the source of truth. Kubernetes shows where work runs, but a Pod label or name
does not grant permission to use a run.

## Main rules

- A duplicate admission returns the first saved input only when the caller and request match.
- A managed run stores the paying group and three authorization digests selected by its conversation.
  Personal runs store all four fields as null. Duplicate and unique-key-race recovery return that
  saved tuple only after the input owner has rechecked current authority; they never adopt a new payer.
- The human requester must match the input message's author. A company assistant keeps its own
  execution identity and permissions; it does not become the human who asked for help.
- Admission creates an exact `AgentRun/Read` grant for the verified personal owner. Retrying an
  admitted request cannot restore a revoked grant. Company runs do not grant their requester personal activity access.
- Status uses the current exact `AgentRun` grant. Ownership, conversation
  participation, lifecycle state, attempt fencing, and execution-subject proof remain separate safety facts;
  none of them grants product permission by itself.
- The conversation-computer authority owns attempt-key issuance after admission. It fences the current
  lease, caps the key to the complete immutable six-field snapshot budget, and keeps encrypted custody
  across worker restarts. Admission and recovery retain the exact policy; they do not fill missing fields,
  replace ceilings, or renew its deadline.
- Runtime events are accepted only for the current run, attempt, computer lease, and command. Their sequence is
  global to the durable run, while terminality is scoped to the attempt that emitted the event.
- Competing writes use serializable database transactions and typed compare-and-set updates.

## Public surface

- `RunAdmissionPayer` carries the original managed paying group and authorization evidence into
  admission. `PrismaRunAdmissionUnitOfWork` persists it with the run and supplies it to duplicate
  verification before releasing the immutable snapshot.
- `PrismaRoutineRunSnapshotRecoveryRepository` returns the saved payer with the checked first
  snapshot, so later routine compilation can recheck current group authority without rebuilding
  admission or changing the payer.

- `PrismaConversationRunLifecycleUnitOfWork` records start, recovery and completion for the admitted
  run attempt and computer lease. A model response that cannot be recovered moves the running
  attempt to `RecoveryRequired`. Restart accepts that state without moving it back to running or
  granting another allowance. Completion still requires durable assistant output.

- `PrismaConversationRunLifecycleUnitOfWork` — idempotently advances an exact lease-fenced
  conversation attempt from accepted to running after the workflow freezes its turn, and from running to
  completed only after durable assistant output. Worker restart uncertainty converges on the same state.

- `PrismaRunAdmissionUnitOfWork` saves a new run and its first lease-bound input snapshot together.
- `PrismaRoutineRunSnapshotRecoveryRepository` reads one already-admitted automatic or manual routine run and returns its first immutable snapshot only after the run, occurrence, requester, workflow-task provenance, execution subject and digest all match. It never admits or creates a run.
- `PrismaRoutineRunProgressUnitOfWork` reads historical routine progress facts only after the run,
  reciprocal occurrence, saved snapshot digest, original workflow receipt and cancellation evidence
  match. It returns null only for a positively identified ordinary interactive run and never admits,
  spawns, or consults current grants.
- `PrismaRoutineRunHistoryRepository` gives scheduling a bounded read-only projection of reciprocal
  routine run and firing coordinates. It validates the trigger, automatic slot, terminal fields and
  complete settled-cost pair; it never creates a run or decides who may read routine history.
- `PrismaSelfRunStatusUnitOfWork` and `_CreatePrismaSelfRunStatusRouter` expose owner-filtered status
  only after the current exact `AgentRun/Read` grant is checked in the same database snapshot.
- `PrismaConversationRunCancellationRepository` binds one requester-authorized Stop command,
  its audit decision and its Absurd cleanup task to the original run attempt. KurrentDB selects
  cancellation or final output first; SQL then converges to `Cancelled/UserCancelled` or the existing
  successful completion without reopening the run.

Personal status includes `latestTool`, either null or the latest invocation's safe phase in the
current attempt. Reads first filter by the authenticated personal owner and current `AgentRun/Read`
permission, then ask the invocation owner for that phase in the same transaction. The response
contains no tool arguments, result content, credentials or provider identifiers. A received tool
result does not mean the assistant has finished its answer. Company-child runs remain outside this
personal activity API; canonical participant receipts belong to conversation history.
The status projection exposes `cancelling` while durable arbitration or cleanup remains active and
`cancelled` only after provider claims no longer hold a fence.

### Managed monthly EUR ledger

`PrismaManagedMonthlyBudgetUnitOfWork` owns the durable money transitions for managed model
requests. It reserves one conservative EUR-micro hold across the global, paying-group and optional
assistant monthly accounts, claims one exact physical request, and then either settles verified
usage, retains the worst case for an unknown outcome, or releases a transport-authenticated request
that provably never reached the provider. Every transition uses the database clock and one bounded
Serializable transaction. Exact replays return the saved winner and cannot dispatch or charge twice.

Reservations freeze the admitted run attempt, payer, model, input/output ceilings, immutable tariff
row and quote digest. A physical claim additionally freezes the request nonce, body digest and
original deadline. Current policies and the frozen tariff are checked again immediately before a
claim, so an older hold cannot bypass a new optional assistant ceiling, a lowered limit, a closed
account, an expired tariff or an elapsed run deadline. Known charges below the hold restore unused
capacity. Unknown outcomes retain the full hold. A representable above-quote charge is recorded as
known settled liability; an unrepresentable charge keeps the hold while retaining exact token and
tariff evidence. Both integrity failures close further admission.

This is a ledger boundary, not operational dispatch enforcement. No current model-request caller is
wired to it yet, and this package does not mark runs, conversations or descendants terminal when a
ceiling closes. A future reviewed system-stop owner must perform that cleanup without fabricating a
human Stop decision. Personal runs return a distinct outcome only when their saved service and
execution subject prove the personal ownership path.

The separate `test:monthly-budget:sql` target checks competing reservations and physical claims
using two PostgreSQL clients. It requires `OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL` to name a
fresh test database loaded with the reviewed baseline; it does not use the general `DATABASE_URL`.
Ordinary tests skip these cases. The test source exists, but database qualification is still pending.

### Run-tree accounting foundation

`PrismaRunTreeRepository` is a transaction-bound foundation for recursive delegation. It is not yet
connected to conversation admission or offered to the model. Its caller must check current product
permissions and commit the child run, snapshot, allocation and workflow receipt in the same
Serializable transaction. The adapter does not open a separate transaction or confer permission.

`AgentRunTreeAccount` records parent/root lineage and an immutable allocation. A child takes a
portion of its parent's available model calls, generated tokens, external tool calls, loop cycles
and cost; it does not get another copy of the root budget. SQL debits available balances, while
`AgentRunTreeReservation` keeps every local debit immutable. Exact retries recover the same record;
changed requests are refused. Uncertain spending is never refunded. Root cost is the lower of the
frozen revision cap, when present, and the explicit trusted server cap. Children cannot extend a
saved deadline. There is no fixed depth, child-count or active-child limit.

New allocations and reservations check every ancestor's current run state, Stop evidence and
deadline under the root lock. Closure records why admission ended; it does not mark provider work
or descendants as cleaned up. Existing receipts remain readable for recovery after closure without
authorizing another effect. The adapter acquires the root before closing a descendant so its lock
order matches allocation and reservation. A conflict must roll back the whole caller transaction.

Until reservation-scoped credentials and tool admission are connected, SQL refuses full-attempt model
custody and unreserved tool work for any account-owned run. The actual key owner is
`ConversationComputerAttemptCredential`, bound to the frozen run and attempt. Account creation and
credential claims lock the same run row, so neither can be admitted after the other. Even a revoked
credential retains this exclusion: deleting a key does not restore spent allowance. These deliberate
refusals prevent a partial rollout from duplicating the budget. Production runs still use the existing
path and create no tree account. Spawning,
selected child context, result return and recursive workflow/key cleanup remain unfinished.

Per-call credential activation also needs a trusted worst-case request cost, including input and
output tokens. The current model definition has no pricing or input-cost bounds, and LiteLLM's
recorded-spend check does not reserve an upcoming request's cost. Splitting nominal key limits alone
would not enforce a shared ceiling across concurrent requests. That activation remains disabled.

The package's `test:sql` target includes baseline guard tests and independent-client transaction
races. That target opts into `OPENCRANE_RUN_TREE_SQL_QUALIFICATION=1` and requires `DATABASE_URL`.
Ordinary tests skip the real-SQL cases even when a database URL is present; a skipped case is not proof.

## Boundary

This package does not choose personas, memory, tools, models, or Kubernetes settings. The input
assembler supplies the fixed run input. The conversation workflow runs the server-owned model loop and rechecks the Agent Sandbox lease and
generation before each effect. The saved budget projection supplies explicit model-turn, completion-token,
tool-invocation, loop-iteration, optional-cost and wall-clock ceilings. Repeated model/tool progression
consumes those frozen counters and retains an allowance for the final answer. The Pod does not
schedule or call the model loop. The running conversation path still spends one run's allowance;
it does not yet use the run-tree accounting foundation above. Delegated child execution,
descendant cancellation and automatic child-result return are not yet wired.

The current text-turn baseline uses approved personal instructions, conversation history and the
selected model. New runs explicitly freeze memory as unavailable. Dataset provisioning and memory
recall remain roadmap work in the [input assembler](../../inputs/main/README.md).

The package does not run uploaded OCI images. OCI-backed MCP and code-skill workloads use their own
executor class and meet AgentRun through the shared workload-claim contract.

## Dependency direction

Tagged `scope:execution-runs`: it may depend on agent-domain, authorization, and
shared backend libraries. It never imports an application or Kubernetes client.

## Data and persistence

The main records are `AgentRun` and its append-only `RunInputSnapshot` rows. Managed monthly money
uses `ManagedBudgetPolicy`, `ManagedBudgetMonthlyAccount`, `ManagedBudgetEffect`,
`ManagedBudgetPhysicalAttempt`, and `ManagedBudgetScopeImpact`; provider-owned
`ModelEurTariffRevision` remains immutable pricing input rather than ledger-owned configuration.
Initial admission saves
the run and attempt-one snapshot together, plus a personal-owner read grant only for a personal
interactive run. Interactive snapshots bind exact final-human-message provenance. Automatic and
manual routine snapshots instead bind the exact routine, revision, firing, slot and original
approval provenance; their `AgentRun` is an independent root linked one-to-one to the firing and
never a delegated tree child. Snapshot version 4 also stores a dedicated JSON array of built-in
capability selections. Its capability, semantic revision and parameter-schema digest are included
in the snapshot digest; duplicate recovery validates and returns the original array instead of
selecting capabilities again. A conversation run later binds
one immutable Absurd task receipt before model or tool work can proceed. A failure rolls back its
whole transaction.

Routine compilation may use the read-only recovery repository after admission commits. A missing
expected run returns no snapshot; a partial or conflicting run, firing or snapshot fails closed.
The caller owns the surrounding transaction and any current authorization or receipt checks.

## See also

- [Conversation authority](../../../../server/conversations/main/README.md)
- [Runtime controller](../../../runtime/controller/README.md)
- [Execution input assembler](../../inputs/main/README.md)
