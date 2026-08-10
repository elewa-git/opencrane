# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › conversations

## What it owns

This package owns the signed-in participant's conversation API and the display-safe replay of
agent-session events. It creates conversations in exactly one immutable mode: `agent_session`,
`direct`, or `group`. An agent session binds one agent service; direct and group conversations do
not bind an agent and their ordinary messages never manufacture runs.

```
 authenticated participant
          │ list · create · open · message · archive · close · replay
          ▼
 ┌──────────────────────────────────────────┐
 │ conversations  ◄── HERE                   │
 │ immutable mode · participant coordinates │
 │ atomic message admission · safe replay   │
 └──────────────────────────────────────────┘
          │ agent-session message       │ direct/group message
          ▼                             ▼
 execution/admission              canonical message only
```

**In this flow:** [execution admission](../../../agents/execution/admission/main/README.md) ·
[channel-proxy](../../../channel-proxy/main/README.md) ·
[AG-UI browser state](../../../../frontend/state/conversation/ag-ui/README.md)

Message admission dispatches through the persisted mode strategy. A direct or group message commits
as a canonical message without an `AgentRun`. An agent-session message enters the internal personal
run-admission port so the message, immutable input snapshot, run, and first dispatch intent commit in
one transaction. A single active foreground run blocks another agent-session message. The public API
does not expose a separate run-start route.

Archive and close are deliberately different. Archive is reversible and affects only one
participant's list. Close is permanent, applies to the conversation, and makes it read-only. Each
participant separately records the first visible position, the last read position, and an optional
access-ended position; reads are clipped to those bounds and writes require continuing access.

The database allocates one monotonically increasing position across message and run-event timeline
entries. Timeline entries hold typed references to canonical rows, never copied payloads. Replay
uses an opaque `{ conversationId, position }` cursor, reads only linked run events, and projects an
allow-listed Agent User Interface (AG-UI) server-sent event snapshot. Unknown events remain visible
as a bounded custom event, but proofs, credentials, fences, and provider metadata never cross the
browser boundary.

The snapshot has no live tail or wake-up loop. The server mounts the adapter only when its
controller-issued `CHANNEL_REPLAY_ROUTE_ID` is configured; the controller must register that exact
endpoint as the current `events.read` channel route. Without both facts, no replay route is exposed.

## Public surface

- `_CreateSelfConversationsRouter` composes the participant-bound list, create, open, message,
  archive, and close API over Prisma and the internal run-admission port.
- `_CreateConversationReplayRepository` composes replay over one `RepeatableRead` transaction so
  access-ending races cannot expose later events.
- `__CreateConversationReplayRouter` mounts internal context-authorized AG-UI replay.
- `_CreateSelfConversationReplayRouter` mounts the participant-authenticated replay route.
- `_SelfConversationsOpenapiPaths` and `_SelfConversationReplayOpenapiPaths` contribute those APIs
  to the server-owned OpenAPI document.

## Boundary

The self API receives only server-derived session and host identity. It never accepts silo,
membership, user, agent authority, or run identifiers as browser-selected trust facts. It creates a
run only by calling the internal execution-admission port for an eligible agent-session message; it
does not assemble inputs, dispatch workloads, or execute agents. The channel replay route separately
requires a consumed one-use context and the exact controller-selected route identifier.

Missing, foreign, closed, access-ended, wrong-mode, duplicate-body, and active-run writes fail
closed through stable denials. Replay likewise returns no rows when participant, silo, cursor, or
visibility bounds do not match.

## Dependency direction

Tagged `scope:conversations` at the backend layer, it may use only its own scope,
`scope:auth`, `scope:channel-targets`, and shared contracts. The auth edge resolves request identity
only. It cannot import an app, frontend state, or deployment package.

## Data & persistence

Owns participant-facing operations over `Conversation`, `ConversationParticipant`,
`ConversationMessage`, and `ConversationTimelineEntry`. The write authority uses serialisable
transactions. The replay adapter is read-only and joins timeline references to `RunEvent`; neither
path reconstructs order from client or run timestamps.

## See also

- Parent index: [server](../../README.md)
- Related authority: [execution admission](../../../agents/execution/admission/main/README.md) ·
  [channel-targets](../../agents/channel-targets/main/README.md)
- Browser consumer: [AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
