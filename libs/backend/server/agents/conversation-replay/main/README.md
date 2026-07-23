# @opencrane/backend/server/agents/conversation-replay — authorised conversation snapshots

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › conversation-replay

## What it owns

This package is the read side of a personal agent conversation. A browser does not read the
canonical event tables directly: the channel proxy first obtains a short-lived, one-use permission
for a specific conversation, then this package consumes that permission and turns the resulting
snapshot into Agent User Interface (AG-UI) server-sent events (SSE). An SSE stream is a normal HTTP
response made of separately resumable event records.

```
 browser ──► channel-proxy ── one-use context ──►
                                      │
                                      ▼
                    ┌────────────────────────────────┐
                    │ conversation-replay  ◄── HERE   │
                    │ participant check · keyset read │
                    │ redact payload · AG-UI SSE      │
                    └────────────────────────────────┘
                                      │ display-safe snapshot
                                      ▼
                                  browser state
```

**In this flow:** [channel-proxy](../../../../channel-proxy/main/README.md) ·
[channel-targets](../../channel-targets/main/README.md) · [AG-UI browser state](../../../../../frontend/state/conversation/ag-ui/main/README.md)

It owns the opaque cursor format, participant-bound Postgres read, redaction allow-list, and the
internal route adapter. The cursor names one immutable event and is accepted only when that event
exists in the same authorised thread; an altered, foreign, or missing position returns no data.
Known event fields become standard AG-UI events. Unknown events remain observable as a small custom
event, while raw stored payloads—such as proofs, fences, credentials, or provider metadata—never
cross the browser boundary.

The snapshot has no live tail or wake-up loop. The server mounts the adapter only when its
controller-issued `CHANNEL_REPLAY_ROUTE_ID` is configured; the controller must register that exact
endpoint as the current `events.read` channel route. Without both facts, no replay route is exposed.

## Public surface

- `__EncodeConversationReplayCursor` and `__DecodeConversationReplayCursor` create and validate an
  opaque resume position.
- `__ReadConversationReplay` applies server-owned bounds and display-safe redaction to repository
  rows.
- `PrismaConversationReplayRepository` reads canonical rows after participant and cursor checks.
- `__CreateConversationReplayRouter` consumes the one-use context and writes the AG-UI SSE snapshot.

## Boundary

The caller supplies a consumed channel-context authority and the exact route identifier selected by
the controller. This package does not authenticate a browser, resolve a channel target, create a
run, register an endpoint, or persist new conversation events. It fails closed before a canonical
read whenever the context, cursor, thread, silo, or participant binding is wrong.

## Dependency direction

Tagged `scope:conversation-replay` at the backend layer, it may use only its own scope,
`scope:channel-targets`, and shared contracts. It cannot import an app, frontend state, or deployment
package; the OpenCrane server app is the composition owner.

## Data & persistence

The Prisma adapter reads `ConversationThread`, its explicit participants, `AgentRun`, and
`ConversationRunEvent` from the per-silo product database. It writes nothing. The canonical data
model remains the source of truth; this package only projects an already-authorised read.

## See also

- Parent index: [agents](../../README.md)
- Sibling authority: [channel-targets](../../channel-targets/main/README.md)
- Browser consumer: [AG-UI state](../../../../../frontend/state/conversation/ag-ui/main/README.md)
