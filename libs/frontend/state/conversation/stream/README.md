# @opencrane/state/conversation/stream — browser conversation transport contract

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › stream

## What it owns

This package defines what browser state needs from the shared conversation transport without
choosing how it reaches the browser. The workspace asks this port for live projections and participant
message submission; the session-authenticated WebSocket adapter implements both operations.

```text
 workspace state ── projection + submission ──► conversation/stream  ◄── HERE
                                             ▲
                                             │ implements
                         WebSocket conversation adapter ──► server
```

**In this flow:** [workspace state](../workspace/README.md) · [WebSocket adapter](../adapter/README.md).

The contract keeps reconnecting distinct from failure, carries the last validated Agent User
Interface (AG-UI) state, and requires an abort signal so a screen can stop its own stream. It
contains no HTTP client and grants no conversation or run authority.

## Public surface

- `ConversationEventStream` — the transport-neutral port implemented by a live or test adapter.
- `StreamConversationEventsCommand` — the conversation, abort, resume, retry, and update inputs.
- `ConversationEventStreamUpdate` — one connection phase with the last accepted projection state.
- `ConversationEventStreamStatuses` — connecting, live, reconnecting, aborted, and failed states.
- `SubmitConversationEventStreamMessageCommand` — one retry-stable participant submission.
- `ConversationEventStreamMessageError` — a display-safe refusal or unsettled submission result.

## Boundary

Conversation state and workspace adapters consume this port. The app binds it to a concrete adapter.
This package never opens a transport, decodes concrete wire frames, stores data, or starts an Agent
run.

## Dependency direction

Tagged `scope:web`, `layer:frontend`, and `frontend-role:state`: it may depend on the foundational
AG-UI browser state, shared contracts, models, and pure utilities. It never imports an adapter,
feature, app, or backend package.

## See also

- Parent index: [conversation](../README.md)
- Adapter: [conversation adapter](../adapter/README.md)
- Projection state: [conversation AG-UI](../ag-ui/README.md)
