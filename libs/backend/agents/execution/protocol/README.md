# @opencrane/backend/agents/execution/protocol — runtime protocol authority

> [backend](../../../README.md) › [agents](../../README.md) › [execution](../README.md) › protocol

## What it owns

This package is the checkpoint between OpenCrane and the process that executes a personal or managed
agent. The executor may be implemented in any language; it receives commands and proposes results,
but it does not get to decide what is current or authoritative. This package owns that decision
through the language-neutral `AgentRuntimeProtocol v1`.

Before a command reaches an executor, it checks that the command belongs to the currently assigned
run attempt, carries the exact frozen input snapshot and tagged user-or-service identity, arrives in
order, and is still inside its lease. A service principal cannot be interpreted as a user merely
because both carry signed fleet-membership evidence.

When the executor proposes an event or outside action, it performs the mirror check before another
domain may persist or execute that proposal.

Runtime input follows the same rule. A bounded `runtime_input` or reviewed `a2ui_action` proposal is
turned into a durable elicitation request on the locked candidate transaction before its candidate
id is accepted. Replays must match the exact saved request. Command polling expires tool approvals
and generic requests on that same transaction, and resumes only after neither kind remains pending.
Each transaction binds one `RuntimeElicitationUnitOfWork` through the injected factory and reuses
that bound object for all generic request work in the callback. The port carries request commands,
not a Prisma client, so the persistence transaction cannot leak into a generic domain function.

This package owns both that pure decision and the Prisma-backed adapter that drives it. The adapter
loads and locks the live workload assignment for a connected runtime Pod, mints only the command the
pure authority accepts, and durably advances the monotonic command sequence and the accepted
candidate ids so a transport reconnect can neither reorder nor duplicate work. Its compiler adapter
hydrates the immutable snapshot through the same locked Prisma transaction before dispatch.
For runtime events, the app injects the canonical run-event authority into that transaction. Every
allowed message, tool, usage, safe error, A2UI, or terminal event is persisted before its candidate
id may advance. Unknown event names and unsafe or oversized payloads fail closed without accepting
the candidate id. `run.completed` and `run.failed` additionally become one durable run outcome and
child-to-parent notification. The adapter also passes the exact accepted command kind to that run
authority, allowing only a `start_attempt` coordinate mismatch to fail an assigned run before
`run.started`; resume failures still require the run to be running. A runtime cannot cancel itself;
cancellation remains server-owned.
The package-private candidate-side-effect adapter keeps those event writes and digest-only
`tool.completed` receipts inside the already-admitted transaction; it never dispatches provider I/O.

```
 OpenCrane run authority + immutable snapshot
          │ command + assignment + fence
          ▼
 ┌──────────────────────────────┐
 │ runtime protocol  ◄── HERE    │  command current? candidate replayed?
 └──────────────────────────────┘
          │ accepted candidate only
          ▼
 run / conversation / action authorities decide and persist the proposal
```

**In this flow:** [execution/runs](../runs/main/README.md) · [conversation replay](../../../server/conversations/main/README.md)

Invariant: an executor can only propose a result for a command OpenCrane already accepted for the
exact current attempt and lease. The `cancelling` run state closes command, event-candidate, and
external-action admission immediately through the same `terminal_run` denial used by completed,
failed, and cancelled runs; it is not a second runtime authority. Duplicate command or candidate
identifiers are idempotent; stale, expired, out-of-order, malformed, or mismatched frames are denied
with a stable reason.

Candidate admission creates durable `Preparing` work before the runtime can forget it. A process
worker may retry provider-free preparation at most three times within five minutes. It then acquires
a monotonic claim before calling a provider. An uncertain provider outcome is never treated as a
failure that can be retried blindly: an adapter with a frozen idempotency key may repeat the exact
request, an adapter with trustworthy readback may reconcile without repeating the effect, and every
other adapter enters visible `RecoveryRequired`. Expired claims follow the same policy after a
process restart.

Approval-required preparation stops in `AwaitingApproval`. The production worker derives the exact
tool schema and capability-set digest from the admitted immutable snapshot, verifies the schema
digest again, and asks the authorization authority to create the approval and pause the run in one
transaction. The interrupt id is stable but opaque, and the server gives every request a fixed
15-minute decision window. If the process stops between preparation and approval creation, the next
worker pass recovers the same request without calling the provider.

It intentionally owns no HTTP listener, Kubernetes resource, model driver, or provider credential.
Its production factory composes a server-side external-action worker from the ToolInvocation unit
of work, immutable snapshot loader, personal configuration authority, execution-user memory
permission authority, and fail-closed provider adapters. Current Obot and sandbox ports expose
neither provider idempotency nor readback, so they deliberately use manual recovery. Every recovery
strategy forwards the claimed invocation and monotonic claim instead of dropping that authority.
Personal-memory recall first opens its exact elicitation receipt, then verifies that receipt against
the current unexpired dispatch claim after acquisition. It stops with
`safe_delivery_required` before Cognee until recalled content has a transient delivery path that
cannot enter ToolInvocation results, outboxes, runtime commands, events, logs, Activity, or A2UI.
The app supplies process persistence, transports, and
structured logging, then drains the worker before disconnecting Prisma. An integration action has the fixed
`integration:<integrationId>:<toolName>` shape: its live custody reference and revision allow-list
are rechecked at execution, so the runtime never sees either credential or mutable permission state.

## Public surface

- `__CreateProductionRuntimeDispatchAuthority` — constructs the ready production authority,
  including first-party personal-session tool augmentation, durable candidate admission, one-time
  saved tool and elicitation result resume, and canonical event reporting. Personal snapshots expose
  a sealed, approval-required `memory:recall` descriptor; the compiler has no memory-gateway port.
- `__CreateProductionExternalActionWorker` — constructs the bounded process worker that prepares,
  claims, executes, reconciles, and recovers durable ToolInvocations.
- `__CreateProductionExternalActionApprovalOpener` — binds an approval-required invocation to its
  frozen schema and opens or recovers the canonical bounded approval request.
- `_CreateSteeringIngestRouter` — the ready-to-mount Prisma composition that maps the shared
  authenticated request principal into the steering caller and supplies the queue and clock.
- `_RuntimeSteeringOpenapiPaths` — contributes the steering contract to the server-owned API spec.

Pure protocol decisions, Prisma adapters, provider executor construction, and recovery strategies
remain inside this package. Provider results are persisted before the runtime receives them; the
runtime never receives a provider credential or calls Obot directly.

`RuntimeElicitationUnitOfWork` and `RuntimeElicitationUnitOfWorkFactory` are package-private ports.
Production composition binds them to the elicitation package's exact-transaction adapter. Tests may
supply a small fake, but runtime dispatch always requires a factory and never guesses around a
missing request authority.

## Boundary

The runtime opens its authenticated stream outward to OpenCrane. This library makes stale,
replayed, expired, mismatched, cancelling, and terminal frames fail closed. It owns admission only;
cancellation and durable events remain with their canonical authorities.

## Data & persistence

The compiler adapter reads the immutable persona, conversation, artifact, skill, and model-route
records needed to compile a dispatch. It never persists a recall query or memory content in compiled
input. The model chooses a query through the approval-required `memory_recall` tool; safe transient
content delivery is deferred to #601. The adapter seals the current fenced run attempt into the
compiled input without mutating the stored snapshot and rejects any compiler result whose run or
attempt disagrees with dispatch authority. It turns the snapshot's integration assignments directly
into approval-required tool descriptors. The dispatch adapter owns two Postgres models in
`runtime.prisma`: `RuntimeCommandStream` (one per run
attempt — the lease fence, the bound runtime instance, the next command sequence, and accepted
candidate ids) and `RuntimeDispatchedCommand` (one row per minted command, whose ids are exactly the
attempt's accepted command set). Their clean-database schema lives in the OpenCrane-owned target
baseline. It reads the assignment, run, and immutable snapshot rows owned by the execution-run and
conversation domains. Canonical events and terminal state remain written by the injected
execution-run authority, never by this transport/protocol package directly.

`RuntimeSteeringRequest` holds each owner-authored instruction before the runtime observes it. The
first fenced resume command may consume every pending request and seed the runtime's pre-model buffer.
Steering alone cannot mint another resume while that executor loop may still be active. A later
deferred-tool approval marker may mint a later resume because the intervening
`Running → WaitingForInput → Running` cycle proves the previous loop paused at a governed tool
boundary. Each command consumes only its exact durable markers, so reconnect redelivers the stored
frame byte-for-byte without reopening the batch. Its queue is deliberately separate from
`RuntimeSteeringBoundary`, which remains the sole authority that can advance input generation. A lost
browser connection therefore cannot drop an instruction or force a model turn to change mid-flight.

| Durable run state | New evidence | Command-poll outcome |
| --- | --- | --- |
| `WaitingForInput` | one or more deadlines are due | Expire due rows in the held transaction; remain idle until the batch has no pending row. |
| `Running` before any resume | approval marker or queued steering | Mint one resume and consume exactly those markers. |
| `Running` after a prior resume | fresh approval marker | Mint the next batch resume. |
| `Running` after a prior resume | steering only | Remain idle; do not supersede the active loop. |
| `Cancelling` | any stale approval, steering marker, or reconnect frontier | Cancellation wins; skip stored start/resume delivery and mint or redeliver the sole newer positive stop command. |

## Dependency direction

Tagged `scope:execution-protocol` (`layer:backend`): it may depend on agent, execution-run,
execution-input, and personal-configuration contracts, authentication, authorization, the
integration authority, the three injected transport-port scopes, and shared contracts. Tool
descriptors are projected only from the immutable snapshot; no decision or resume path consults a
live catalogue. Candidate arguments and the schema digest are validated before admission, and the
same frozen schema is propagated to deferred approval. The
authentication edge resolves only the
backend-type-free request principal. The integration edge is read-only: it resolves and rechecks the revision's live
custody reference before the Obot invocation port executes an allowed tool. Its fail-closed
transport adapters implement those narrow ports without exposing credentials. The package never
imports an app or a model driver.

## See also

- Parent group: [execution](../README.md)
- Wire contract: [`@opencrane/contracts`](../../../../contracts/README.md)
- Run authority: [execution/runs](../runs/main/README.md)
Personal and managed runtime Pods share the same protocol but not an identity plane: every tagged
snapshot is re-bound to its deployment-owned namespace, projected-token audience, and ServiceAccount
grammar before a command or candidate is accepted.
