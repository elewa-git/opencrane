# @opencrane/state/conversation/stream — browser history connection contract

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › stream

## What it owns

This package defines the transport-neutral browser port for participant-authorized conversation
history. It carries immutable entries, resolved private text, the exclusive next position, and the
current logical conversation computer. Its validator composes the shared entry and computer
schemas, then checks ordered entries and the selected conversation's coordinates.

`ConversationEventStreamStatuses` distinguishes initial connection, live history, retry, abort,
current-access loss, and terminal failure. An `AbortSignal` stops the connection when selection
changes. Access loss requires the workspace to discard the selected private history and draft;
transient failures retain the last accepted projection for recovery.

## Public surface

- `ConversationEventStream` is the transport-neutral history port.
- `ConversationEventStreamStatuses` names connection outcomes and the required state handling.
- `ConversationHistoryProjection` holds the validated browser history and computer state.
- `__ParseConversationHistoryProjection` validates a response against its requested conversation
  and previous decimal cursor.
- `__CreateConversationHistoryProjection` creates the initial empty browser projection.

## Boundary

The port grants no conversation, run, or sandbox authority. A concrete adapter authenticates as the
signed-in participant and interprets its protocol before adopting validated data. SSE's absent
computer update does not erase the computer supplied by a separate history read.

## See also

- HTTP and SSE adapter: [`../adapter`](../adapter/README.md)
- Workspace state: [`../workspace`](../workspace/README.md)
