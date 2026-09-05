# @opencrane/state/conversation/stream — browser history polling contract

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › stream

## What it owns

This package defines the transport-neutral browser port for finite, participant-authorized
conversation-history reads. It carries immutable `ConversationEntry` records, resolved private text,
the exclusive next position, and current logical conversation-computer state.

`ConversationEventStreamStatuses` distinguishes the initial read, caught-up polling, retry, abort,
and terminal failure. An `AbortSignal` stops polling when the selected conversation changes.

## Public surface

- `ConversationEventStream` is the transport-neutral history polling port.
- `ConversationEventStreamStatuses` names finite polling outcomes.
- `__CreateConversationHistoryProjection` creates the initial immutable browser projection.

## Boundary

The port grants no conversation, run, or sandbox authority. A concrete adapter must authenticate as
the signed-in participant, validate every response, and retain the last complete projection while a
read is retried.

## See also

- HTTP adapter: [`../adapter`](../adapter/README.md)
- Workspace state: [`../workspace`](../workspace/README.md)
