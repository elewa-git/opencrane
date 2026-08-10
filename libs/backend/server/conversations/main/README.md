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
uses an opaque `{ conversationId, position, subframe? }` cursor, reads linked messages and run
events, and projects an allow-listed Agent User Interface (AG-UI) server-sent event stream. Unknown events remain visible
as a bounded custom event, but proofs, credentials, fences, and provider metadata never cross the
browser boundary.

Governed A2UI replay adopts only the exact `opencrane.a2ui.v1` envelope bound to the replayed
conversation and run. It preserves ordered upstream `beginRendering`, `surfaceUpdate`, and
`dataModelUpdate` operations, admits only the nine upstream component wrappers, and forwards the
server-selected ten-state presentation lifecycle plus optional bounded safe reason. Replay never
maps the frontend-only `SingleChoice` or `Select` aliases into upstream authority and never infers
an action or lifecycle transition locally.

Each response drains the durable snapshot before entering a bounded live tail. Recovery polling is
authoritative; wake-ups may reduce latency later but can never replace a database read. The server
rechecks organisation membership and participant bounds on every page, emits heartbeats below the
proxy idle fence, and ends at five minutes so clients reconnect with the exact last subframe cursor.
Still-open approval interrupts are overlays without SSE ids, so reconnect restores them without
advancing `Last-Event-ID`. Proven revocation emits a bounded purge signal and closes the stream.

## Public surface

- `_CreateSelfConversationsRouter` composes the participant-bound list, create, open, message,
  archive, and close API over Prisma and the internal run-admission port.
- `_CreateConversationReplayRepository` composes replay over one `RepeatableRead` transaction so
  access-ending races cannot expose later events.
- `__CreateConversationReplayRouter` mounts internal context-authorized AG-UI snapshot-to-live replay.
- `_CreateSelfConversationReplayRouter` mounts the participant-authenticated live replay route.
- `__StreamConversationLiveReplay` owns page draining, deterministic subframes, polling,
  heartbeats, interrupt restoration, revocation, and the response-duration fence.
- `__ProjectConversationReplayEvent` strictly redacts canonical rows and adopts only full-coordinate,
  catalogue-safe governed A2UI envelopes before the shared AG-UI projector can emit them.
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

Tagged `scope:conversations` at the backend layer, it may use only its own scope,
`scope:auth`, `scope:channel-targets`, and shared contracts. The auth edge resolves request identity
only. It cannot import an app, frontend state, or deployment package.

## Data & persistence

Owns participant-facing operations over `Conversation`, `ConversationParticipant`,
`ConversationMessage`, and `ConversationTimelineEntry`. The write authority uses serialisable
transactions and projects create, archive, and close results from the same authorised write
snapshot. The replay adapter is read-only and joins timeline references to canonical messages and
`RunEvent`; neither path
reconstructs order from client or run timestamps. All paths depend on current active `OrgMembership`
in the caller's host-selected silo; participant rows alone never preserve authority after revocation.

## See also

- Parent index: [server](../../README.md)
- Related authority: [execution admission](../../../agents/execution/admission/main/README.md) ·
  [channel-targets](../../agents/channel-targets/main/README.md)
- Browser consumer: [AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
