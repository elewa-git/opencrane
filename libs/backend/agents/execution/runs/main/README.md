# @opencrane/backend/agents/execution/runs — agent-run authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › runs

## What it owns

A **run** is one request for an agent to do work. An **attempt** is one try at finishing that run.
This package admits personal and company-assistant conversation runs and freezes their fixed input in one database transaction.
For a new personal run, that transaction also grants its verified owner permission to read its activity.
The active conversation-computer lease and its Sandbox claim are independently proven inputs; the
transaction does not create or claim that runtime. The conversation computer continues the turn after
admission; this package does not create a second managed workflow task for it.

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
 independently lease-bound conversation computer continues the turn
   │
   ▼
 agent works → server saves events → lifecycle settles the governed workload
```

**In this flow:** [input assembler](../../inputs/main/README.md) · [conversation authority](../../../../server/conversations/main/README.md) · [runtime controller](../../../runtime/controller/README.md)

The server is always the source of truth. Kubernetes shows where work runs, but a Pod label or name
does not grant permission to use a run.

## Main rules

- A duplicate admission returns the first saved input only when the caller and request match.
- The human requester must match the input message's author. A company assistant keeps its own
  execution identity and permissions; it does not become the human who asked for help.
- Admission creates an exact `AgentRun/Read` grant for the verified personal owner. Retrying an
  admitted request cannot restore a revoked grant. Company runs do not grant their requester personal activity access.
- Status uses the current exact `AgentRun` grant. Ownership, conversation
  participation, lifecycle state, attempt fencing, and execution-subject proof remain separate safety facts;
  none of them grants product permission by itself.
- The conversation-computer authority owns attempt-key issuance after admission. It fences the current
  lease, caps the key to the immutable snapshot budget, and keeps encrypted custody across worker restarts.
- Runtime events are accepted only for the current run, attempt, computer lease, and command. Their sequence is
  global to the durable run, while terminality is scoped to the attempt that emitted the event.
- Competing writes use serializable database transactions and typed compare-and-set updates.

## Public surface

- `PrismaConversationRunLifecycleUnitOfWork` — idempotently advances an exact lease-fenced
  conversation attempt from accepted to running after durable bootstrap, and from running to
  completed only after durable assistant output. Worker restart uncertainty converges on the same state.

- `PrismaRunAdmissionUnitOfWork` saves a new run and its first lease-bound input snapshot together.
- `PrismaSelfRunStatusUnitOfWork` and `_CreatePrismaSelfRunStatusRouter` expose owner-filtered status
  only after the current exact `AgentRun/Read` grant is checked in the same database snapshot.

## Boundary

This package does not choose personas, memory, tools, models, or Kubernetes settings. The input
assembler supplies the fixed run input. The conversation-computer boundary runs the model loop
through an Agent Sandbox lease.

The current text-turn baseline uses approved personal instructions, conversation history and the
selected model. New runs explicitly freeze memory as unavailable. Dataset provisioning and memory
recall remain roadmap work in the [input assembler](../../inputs/main/README.md).

The package does not run uploaded OCI images. OCI-backed MCP and code-skill workloads use their own
executor class and meet AgentRun through the shared workload-claim contract.

## Dependency direction

Tagged `scope:execution-runs`: it may depend on agent-domain, authorization, and
shared backend libraries. It never imports an application or Kubernetes client.

## Data and persistence

The main records are `AgentRun` and its append-only `RunInputSnapshot` rows. Initial admission saves
the run, attempt-one snapshot and personal-owner read grant together. A failure rolls them all back.

## See also

- [Conversation authority](../../../../server/conversations/main/README.md)
- [Runtime controller](../../../runtime/controller/README.md)
- [Execution input assembler](../../inputs/main/README.md)
