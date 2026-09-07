# @opencrane/state/conversation/adapter — conversation history and server events

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › adapter

## What it owns

`OpenCraneConversationEventStream` reads initial participant history, then follows
`GET /api/v1/me/conversations/{conversationId}/events` through the generated client with
`parseAs: "stream"`. The existing session cookie and 401 sign-in handling apply to both requests.
Accepted event IDs become the exclusive cursor in the next URL and `Last-Event-ID` header.

The server event pages contain `computer: null`; they retain the last computer read from `/history`.
Every 30 seconds the adapter closes that event connection, refreshes `/history` after the accepted
cursor, then opens the next event connection. There is no parallel history polling loop. **The
initial history read and these computer refreshes still use the existing full computer-history
replay on the server.** This change removes one-second polling; it does not eliminate that replay
cost or provide a computer event projection.

## Public surface

- `OpenCraneConversationEventStream` implements the browser history port with the generated client.

## Boundary

The server derives participant and silo identity from the session. The decoder holds at most one
512 KiB encoded SSE frame and cancels a pending reader when selection changes. Model-adjacent
validators check entries, computer coordinates, decimal progress, and the selected conversation.
SSE cannot replace the computer projection or move the accepted cursor backwards.

Duration, idle, and response-size closes reconnect without consuming the failure allowance. A
five-second minimum between connection starts prevents a rapid normal-close loop. Failed reads
have exponential backoff and a limited retry count; HTTP 429 honors `Retry-After` (delays over five
minutes require explicit recovery). A terminal `unavailable` event or malformed frame is never
retried automatically. Current-access failures clear the private projection and tell the workspace
to purge its selection and draft; transient failures retain accepted data. No raw server errors are
displayed, and this adapter never submits messages or receives sandbox credentials.

## See also

- Port and validators: [`../stream`](../stream/README.md)
- Workspace adapter: [`../workspace/adapter`](../workspace/adapter/README.md)
