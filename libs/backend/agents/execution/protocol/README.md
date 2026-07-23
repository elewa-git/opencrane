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
Its external-action adapter routes an admitted action through injected custody, sandbox, or memory
ports; the app supplies those concrete ports and composes the library with the stream transport and
the existing run/conversation authorities; a runtime can only submit candidates for those
authorities to accept or reject.

## Public surface

- `__AdmitRuntimeCommand` — validates a control-plane command before stream delivery.
- `__AdmitRuntimeCandidate` — validates a runtime-proposed event or deferred action.
- `PrismaRuntimeDispatchAuthority` — the durable adapter the app injects into the stream transport;
  it loads assignment authority, mints and advances commands, admits candidates, and releases the
  runtime-instance binding on stream loss.
- `__CreatePrismaRunInputCompiler` — binds the deterministic prompt compiler to the control-plane
  Prisma reads used by the dispatch transaction.
- `__CreateExternalActionExecutor` — routes one admitted action to the injected MCP custody,
  sandbox, or memory port and fails closed for unsupported revisions.
- `RuntimeStreamWorkloadIdentity` / `RuntimeCandidateDispatchResult` / `RuntimeDispatchAuthorityConfig`
  — the identity handed in by the transport, the candidate result, and the fixed dispatch policy.
- `RuntimeAttemptAuthority` — exact durable facts, including current run state, that the owning run
  authority must supply at the final acceptance fence.
- `RuntimeAdmissionRunState` — run lifecycle values understood by the admission fence, including the
  non-terminal-but-closed `cancelling` state.
- `RuntimeCommandAdmission*` / `RuntimeCandidateAdmission*` — typed allow, idempotent, or fail-closed
  decisions and their input ports.

## Boundary

The runtime opens its authenticated stream outward to OpenCrane. This library makes stale,
replayed, expired, mismatched, cancelling, and terminal frames fail closed; it does not create an
OpenClaw compatibility path, a cancellation side authority, or a second durable event authority.

## Data & persistence

The compiler adapter reads the immutable persona, conversation, artifact, skill, and model-route
records needed to compile a dispatch. The dispatch adapter owns two Postgres models in
`runtime.prisma`: `RuntimeCommandStream` (one per run
attempt — the lease fence, the bound runtime instance, the next command sequence, and accepted
candidate ids) and `RuntimeDispatchedCommand` (one row per minted command, whose ids are exactly the
attempt's accepted command set). Their clean-database schema lives in the OpenCrane-owned target
baseline. It reads the assignment, run, and immutable snapshot rows owned by the execution-run and
conversation domains but never writes those authorities.

## Dependency direction

Tagged `scope:execution-protocol` (`layer:backend`): it may depend on runtime-controller ports,
agent, execution-run, personal-conversation, authorization, the three injected transport-port scopes, and shared
contracts. It never imports an app, concrete transport adapter, model driver, or legacy runtime package.

## See also

- Parent group: [execution](../README.md)
- Wire contract: [`@opencrane/contracts`](../../../../../contracts/README.md)
- Run authority: [execution/runs](../runs/main/README.md)
