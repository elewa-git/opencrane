# @opencrane/backend/agents/execution/protocol — runtime protocol authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › protocol

## What it owns

This package is the checkpoint between OpenCrane and the process that executes a personal or managed
agent. The executor may be implemented in any language; it receives commands and proposes results,
but it does not get to decide what is current or authoritative. This package owns that decision
through the language-neutral `AgentRuntimeProtocol v1`.

Before a command reaches an executor, it checks that the command belongs to the currently assigned
run attempt, carries the exact frozen input snapshot, arrives in order, and is still inside its lease.
When the executor proposes an event or outside action, it performs the mirror check before another
domain may persist or execute that proposal.

This package owns both that pure decision and the Prisma-backed adapter that drives it. The adapter
loads and locks the live workload assignment for a connected runtime Pod, mints only the command the
pure authority accepts, and durably advances the monotonic command sequence and the accepted
candidate ids so a transport reconnect can neither reorder nor duplicate work. Its compiler adapter
hydrates the immutable snapshot through the same locked Prisma transaction before dispatch.
For the two workload-reportable terminal results, the app injects the canonical run authority into
that transaction: `run.completed` and `run.failed` become one durable run outcome, stream event, and
child-to-parent notification. A runtime cannot cancel itself; cancellation remains server-owned.

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

**In this flow:** [execution/runs](../runs/main/README.md) · [personal/conversations](../../personal/conversations/main/README.md)

Invariant: an executor can only propose a result for a command OpenCrane already accepted for the
exact current attempt and lease. The `cancelling` run state closes command, event-candidate, and
external-action admission immediately through the same `terminal_run` denial used by completed,
failed, and cancelled runs; it is not a second runtime authority. Duplicate command or candidate
identifiers are idempotent; stale, expired, out-of-order, malformed, or mismatched frames are denied
with a stable reason.

An admitted external action can be replayed only before its runner creates a durable invocation
receipt. That narrow failure returns an explicit bounded retry result from a server-owned per-candidate
budget and deadline, so a reconnecting runtime cannot reset it. The runtime resubmits the same
candidate identifier rather than falsely treating the action as accepted or emitting a terminal
executor error. Once a runner records a durable refusal or result, that outcome is final and remains
fail closed.

It intentionally owns no HTTP listener, Kubernetes resource, model driver, or provider credential.
Its external-action adapter routes an admitted action through injected integration custody, sandbox,
or memory ports; the app supplies those concrete ports and composes the library with the stream
transport and the existing run/conversation authorities. An integration action has the fixed
`integration:<integrationId>:<toolName>` shape: its live custody reference and revision allow-list
are rechecked at execution, so the runtime never sees either credential or mutable permission state.

## Public surface

- `__AdmitRuntimeCommand` — validates a control-plane command before stream delivery.
- `__AdmitRuntimeCandidate` — validates a runtime-proposed event or deferred action.
- `PrismaRuntimeDispatchAuthority` — the durable adapter the app injects into the stream transport;
  it loads assignment authority, mints and advances commands, admits candidates, and releases the
  runtime-instance binding on stream loss.
- `__CreatePrismaRunInputCompiler` — binds the deterministic prompt compiler to the control-plane
  Prisma reads used by the dispatch transaction.
- `__CreateExternalActionExecutor` — routes one admitted action to the injected integration
  custody, sandbox, or memory port and fails closed for unsupported revisions. Third-party tools use
  only `integration:<integrationId>:<toolName>` identities frozen from the AgentRevision assignment.
  Memory recall additionally requires a `scope: personal` policy and Cognee dataset identifier frozen
  in the admitted snapshot; neither runtime tool arguments nor a subject id can choose a dataset.
- `RuntimeStreamWorkloadIdentity` / `RuntimeCandidateDispatchResult` / `RuntimeDispatchAuthorityConfig`
  — the identity handed in by the transport, the candidate result, and the fixed dispatch policy.
- `RuntimeTerminalReporter` — the composition-root port that persists permitted terminal results
  through the run authority without making this protocol package own run state.
- `RuntimeAttemptAuthority` — exact durable facts, including current run state, that the owning run
  authority must supply at the final acceptance fence.
- `RuntimeAdmissionRunState` — run lifecycle values understood by the admission fence, including the
  non-terminal-but-closed `cancelling` state.
- `RuntimeCommandAdmission*` / `RuntimeCandidateAdmission*` — typed allow, idempotent, or fail-closed
  decisions and their input ports.
- `__CreateSteeringIngestRouter`, `PrismaSteeringRequestRepository` — the self-only product surface
  and durable queue for a user's instruction to a live run. It records the instruction against the
  current owner-bound attempt but never changes input generation from the HTTP request.

## Boundary

The runtime opens its authenticated stream outward to OpenCrane. This library makes stale,
replayed, expired, mismatched, cancelling, and terminal frames fail closed; it does not create an
OpenClaw compatibility path, a cancellation side authority, or a second durable event authority.

## Data & persistence

The compiler adapter reads the immutable persona, conversation, artifact, skill, and model-route
records needed to compile a dispatch, and turns the snapshot's integration assignments directly
into approval-required tool descriptors. The dispatch adapter owns two Postgres models in
`runtime.prisma`: `RuntimeCommandStream` (one per run
attempt — the lease fence, the bound runtime instance, the next command sequence, and accepted
candidate ids) and `RuntimeDispatchedCommand` (one row per minted command, whose ids are exactly the
attempt's accepted command set). Their clean-database schema lives in the OpenCrane-owned target
baseline. It reads the assignment, run, and immutable snapshot rows owned by the execution-run and
conversation domains. Terminal state remains written by the injected execution-run authority, never
by this transport/protocol package directly.

`RuntimeSteeringRequest` holds each owner-authored instruction before the runtime observes it. A
request can be accepted only before the attempt's single fenced resume command is minted; that command
consumes every pending request and seeds the runtime's pre-model buffer. This prevents a second
executor loop from running concurrently for the same attempt. Its queue is deliberately separate from
`RuntimeSteeringBoundary`, which remains the sole authority that can advance input generation. A lost
browser connection therefore cannot drop an instruction or force a model turn to change mid-flight.

## Dependency direction

Tagged `scope:execution-protocol` (`layer:backend`): it may depend on agent and execution-input
contracts, authorization, the integration authority, the three injected transport-port scopes, and
shared contracts. The integration edge is read-only: it resolves and rechecks the revision's live
custody reference before the Obot invocation port executes an allowed tool. The package never imports
an app, a concrete transport adapter, a model driver, or a legacy runtime package.

## See also

- Parent group: [execution](../README.md)
- Wire contract: [`@opencrane/contracts`](../../../../../contracts/README.md)
- Run authority: [execution/runs](../runs/main/README.md)
