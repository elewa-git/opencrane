# @opencrane/backend/agents/runtime — runtime protocol authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../README.md) › main

## What it owns

This package is the checkpoint between OpenCrane and the process that executes a personal agent. The
executor may be implemented in any language; it receives commands and proposes results, but it does
not get to decide what is current or authoritative. This package owns that decision through the
language-neutral `AgentRuntimeProtocol v1`.

Before a command reaches an executor, it checks that the command belongs to the currently assigned
run attempt, carries the exact frozen input snapshot, arrives in order, and is still inside its lease.
When the executor proposes an event or outside action, it performs the mirror check before another
domain may persist or execute that proposal.

This package owns both that pure decision and the Prisma-backed adapter that drives it. The adapter
loads and locks the live workload assignment for a connected runtime Pod, mints only the command the
pure authority accepts, and durably advances the monotonic command sequence and the accepted
candidate ids so a transport reconnect can neither reorder nor duplicate work.

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

**In this flow:** [personal/runs](../../personal/runs/main/README.md) · [personal/conversations](../../personal/conversations/main/README.md)

Invariant: an executor can only propose a result for a command OpenCrane already accepted for the
exact current attempt and lease. The `cancelling` run state closes command, event-candidate, and
external-action admission immediately through the same `terminal_run` denial used by completed,
failed, and cancelled runs; it is not a second runtime authority. Duplicate command or candidate
identifiers are idempotent; stale, expired, out-of-order, malformed, or mismatched frames are denied
with a stable reason.

It intentionally owns no HTTP listener, Kubernetes resource, model driver, provider credential,
tool execution, or direct persistence adapter. The app composes it with the stream transport and
the existing run/conversation authorities; a runtime can only submit candidates for those
authorities to accept or reject.

## Public surface

- `__AdmitRuntimeCommand` — validates a control-plane command before stream delivery.
- `__AdmitRuntimeCandidate` — validates a runtime-proposed event or deferred action.
- `PrismaRuntimeDispatchAuthority` — the durable adapter the app injects into the stream transport;
  it loads assignment authority, requires the exact consumed bootstrap and live proof-key binding,
  mints and advances commands, admits candidates, and releases the runtime-instance binding on
  stream loss.
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

The adapter owns two Postgres models in `runtime.prisma`: `RuntimeCommandStream` (one per run
attempt — the lease fence, the bound runtime instance, the next command sequence, and accepted
candidate ids) and `RuntimeDispatchedCommand` (one row per minted command, whose ids are exactly the
attempt's accepted command set). Their clean-database shape lives in the app-owned
`apps/opencrane/prisma/bootstrap/target-baseline.sql`; there is no incremental migration path or
runtime schema runner. The adapter reads the assignment, run, and immutable snapshot rows owned by
the personal-run and conversation domains plus the consumed bootstrap and proof-key rows owned by
authorization, but never writes them.

## Dependency direction

Tagged `scope:agent-runtime` (`layer:backend`): it may depend only on runtime, agent, personal-run,
personal-conversation, authorization, and shared contracts. It never imports an app, transport
adapter, model driver, or legacy runtime package.

## See also

- Parent group: [runtime](../README.md)
- Wire contract: [`@opencrane/contracts`](../../../../../contracts/README.md)
- Run authority: [personal/runs](../../personal/runs/main/README.md)
