# @opencrane/backend/conversations/agent-threads — child Agent-thread contracts

> [backend](../../../README.md) › [conversations](../../README.md) › agent-threads

## What it owns

This package defines the stable language for turning an authorised `@agent` group message into a
separate child `agent_session`. The server checks the parent and target, then persists both histories
and the first run together. Later, the child may send a small sanitized update to its immediate
parent without copying its internal transcript.

```text
 group message + exact target
             │
             ▼
 ┌──────────────────────────────┐
 │ agent-threads  ◄── HERE      │  target · origin · delivery · summary
 └──────────────────────────────┘
             │
             ▼
 child agent_session + first run
```

**In this flow:** [server conversations](../../../server/conversations/main/README.md) performs the
authorised transaction, while [projection](../../projection/main/README.md) exposes safe events.

The root mention remains an ordinary group message. The child always has an immutable parent,
originating message, initiator, personal Agent service and approved persona revision. Runtime child
runs remain a separate execution concept.

## Public surface

- `__DecideAgentThreadTarget` checks one exact structured Agent target without doing I/O.
- `AgentThreadOrigin` describes immutable breadcrumb and first-run coordinates.
- `AgentThreadDeliveryKinds` and `AgentThreadParentDelivery` constrain upward communication.
- `AgentThreadSummaryStates` and `AgentThreadSummary` define the bounded parent projection.

## Boundary

This package owns no HTTP, Prisma, runtime dispatch or frontend state. The server conversations
authority must re-check live parent participation for every child read and write. Delivery detail
must already be sanitized; it may never contain credentials, proofs, raw tool arguments, provider
bodies or private memory. A memory-permission question must warn that any derived answer is visible
to the active group.

## Dependency direction

The package has `scope:conversation-agent-threads` and may depend only on itself and shared,
dependency-neutral code. Server and browser adapters depend on it, never the reverse.

## See also

- Parent index: [conversations](../../README.md)
- Safe stream: [projection](../../projection/main/README.md)
- Persistence and routes: [server conversations](../../../server/conversations/main/README.md)
