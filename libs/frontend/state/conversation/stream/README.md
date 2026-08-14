# @opencrane/state/conversation/stream — the browser stream contract

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › stream

## What it owns

This package defines what browser state needs from the shared conversation event stream without
choosing how the stream reaches the browser. The workspace store asks this port for updates; the
separate HTTP adapter implements it with the signed-in session.

```text
 workspace state ── asks the port ──► conversation/stream  ◄── HERE
                                             ▲
                                             │ implements
                              conversation/adapter ──► server
```

**In this flow:** [workspace state](../workspace/README.md) · [HTTP adapter](../adapter/README.md).

The contract keeps reconnecting distinct from failure, carries the last validated Agent User
Interface (AG-UI) state, and requires an abort signal so a screen can stop its own stream. It
contains no HTTP client and grants no conversation or run authority.

## Public surface

- `ConversationEventStream` — the transport-neutral port implemented by a live or test adapter.
- `StreamConversationEventsCommand` — the conversation, abort, resume, retry, and update inputs.
- `ConversationEventStreamUpdate` — one connection phase with the last accepted projection state.
- `ConversationEventStreamStatuses` — connecting, live, reconnecting, aborted, and failed states.

## Boundary

Conversation state and features consume this port. The app binds it to a concrete adapter. This
package never opens a request, decodes Server-Sent Events (SSE), stores data, or starts an Agent run.

## Dependency direction

Tagged `scope:web`, `layer:frontend`, and `frontend-role:state`: it may depend on the foundational
AG-UI browser state, shared contracts, models, and pure utilities. It never imports an adapter,
feature, app, or backend package.

## See also

- Parent index: [conversation](../README.md)
- Adapter: [conversation adapter](../adapter/README.md)
- Projection state: [conversation AG-UI](../ag-ui/README.md)
