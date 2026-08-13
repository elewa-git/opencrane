# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › conversations

## What it owns

This package owns the signed-in participant's conversation API, canonical timeline and authorised
stream transports. It creates conversations in exactly one immutable mode: `agent_session`,
`direct`, or `group`. An agent session binds one agent service; direct and group conversations do
not bind an agent and their ordinary messages never manufacture runs.

```
 authenticated participant
          │ directory · list · create · open · message · retry run · archive · close · replay
          ▼
 ┌──────────────────────────────────────────┐
 │ conversations  ◄── HERE                   │
 │ immutable mode · participant coordinates │
 │ atomic admission · authorised event read │
 └──────────────────────────────────────────┘
          │ agent-session message       │ direct/group message
          ▼                             ▼
 execution/admission              canonical message only
```

**In this flow:** [execution admission](../../../agents/execution/admission/main/README.md) ·
[channel-proxy](../../../channel-proxy/main/README.md) ·
[conversation projection](../../../conversations/projection/main/README.md) ·
[AG-UI browser state](../../../../frontend/state/conversation/ag-ui/README.md)

Message admission dispatches through the persisted mode strategy. A direct or group message commits
as a canonical message without an `AgentRun`. An agent-session message enters the internal personal
run-admission port so the message, immutable input snapshot, run, and first dispatch intent commit in
one transaction. A single active foreground run blocks another agent-session message. The public API
does not expose a separate run-start route.

The general conversation unit of work owns participant reads and aggregate lifecycle writes. A
dedicated message-admission unit owns submission routing, retry recovery, denial translation, and
the handoff into execution admission's authoritative final transaction.
Participant run retry is injected through the runs package's `RunRetryAuthority`; conversation
composition supplies route and session facts but neither constructs a run repository nor owns its
transaction retries.

Before creation, the directory returns active organisation members as opaque membership references.
It never returns login subjects, email addresses, roles, or personal-memory identity. It also
projects the caller's active personal Agent only when exactly one service matches their approved
persona; no match is unavailable and more than one match is ambiguous, so the server never silently
chooses an Agent.

Participant artifact blocks are delegated to the conversation-assets attachment port inside that
same ordinary-message or run-admission transaction. Any foreign, unchecked, reused, or oversized
asset rolls the message back instead of leaving a dangling transcript reference.

Archive and close are deliberately different. Archive is reversible and affects only one
participant's list. Close is permanent, applies to the conversation, and makes it read-only. Each
participant separately records the first visible position, the last read position, and an optional
access-ended position; reads are clipped to those bounds and writes require continuing access.
Opening a child Agent-thread returns exact unread message count separately from timeline positions.
The participant may then advance `readThroughPosition` through the exact parent-child route. That
mutation is monotonic and idempotent, rechecks current parent and child access, and refuses any
position beyond the current canonical child timeline.

The database allocates one monotonically increasing position across message and run-event timeline
entries. Timeline entries hold typed references to canonical rows, never copied payloads. The replay
repository checks membership and participant bounds and reads those linked rows in one repeatable
snapshot. It hands the result to the separate
[conversation projection package](../../../conversations/projection/main/README.md), which owns
redaction, Agent User Interface (AG-UI) mapping, cursors and live streaming for every mode.
Safe technical failure classifications remain visible there, including when a later attempt retries
the tool, while credentials and provider details are never exposed.

The server rechecks organisation membership and participant bounds on every page. Its Express
adapter supplies backpressure and request cancellation to projection. The two stream routes differ
only in how they establish authority: one consumes a single-use channel context; the other derives
the participant from the signed-in browser session.

## Public surface

- `_CreateSelfConversationsRouter` composes the privacy-safe creation directory, participant-bound list, create, open, message,
  Agent-thread mark-read, failed-run retry, archive, and close API over Prisma and the internal
  execution ports. Retry accepts only an observed terminal attempt and a fresh idempotency key; all
  identity and authority coordinates come from the signed-in route and are rechecked transactionally.
- `_CreateConversationReplayRepository` composes replay over one `RepeatableRead` transaction so
  access-ending races cannot expose later events.
- `__CreateConversationReplayRouter` mounts internal context-authorized AG-UI snapshot-to-live replay.
- `_CreateSelfConversationReplayRouter` mounts the participant-authenticated live replay route.
- `_SelfConversationsOpenapiPaths` and `_SelfConversationReplayOpenapiPaths` contribute those APIs
  to the server-owned OpenAPI document.

## Boundary

The self API receives only server-derived session and host identity. It never accepts silo,
membership, user, agent authority, or run identifiers as browser-selected trust facts. It creates a
run only by calling the internal execution-admission port for an eligible agent-session message; it
does not assemble inputs, dispatch workloads, or execute agents. The channel replay route separately
requires a consumed one-use context and the exact controller-selected route identifier.

Missing, foreign, closed, access-ended, wrong-mode, duplicate-body, and active-run writes fail
closed through stable denials. The replay persistence port always returns an explicit authorised or
revoked-or-missing outcome from the same snapshot as its rows; it has no rows-only fallback that
could turn authority loss into an empty successful page. Every self-service read and write also
rechecks active organisation membership inside its own database snapshot, so revocation closes
list, open, retry, archive, close, message, and replay authority immediately. Admission overload is
returned as `capacity_limited` rather than being misreported as a persistence outage.

## Dependency direction

Tagged `scope:conversations` at the backend layer, it may use its own scope, the narrow
`scope:conversation-projection` engine, its listed backend authorities, and shared contracts. The
auth edge resolves request identity only. It cannot import an app, frontend state, or deployment
package.

## Data & persistence

Owns participant-facing operations over `Conversation`, `ConversationParticipant`,
`ConversationMessage`, and `ConversationTimelineEntry`. The write authority uses serialisable
transactions and projects create, archive, and close results from the same authorised write
snapshot. Message admission separately uses serialisable ordinary-message writes and binds agent
messages to execution admission's final transaction. The replay adapter is read-only and joins
timeline references to canonical messages and `RunEvent`; neither path
reconstructs order from client or run timestamps. All paths depend on current active `OrgMembership`
in the caller's host-selected silo; participant rows alone never preserve authority after revocation.

## See also

- Parent index: [server](../../README.md)
- Related authority: [execution admission](../../../agents/execution/admission/main/README.md) ·
  [channel-targets](../../agents/channel-targets/main/README.md)
- Stream engine: [conversation projection](../../../conversations/projection/main/README.md)
- Browser consumer: [AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
