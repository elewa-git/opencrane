# @opencrane/state/conversation/adapter — Kurrent history HTTP polling

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › adapter

## What it owns

`OpenCraneConversationEventStream` implements the shared history port through the generated,
same-origin client. It repeatedly reads
`GET /api/v1/me/conversations/{conversationId}/history?afterPosition=...`, validates immutable
entries and payload resolutions, and resumes strictly after the last accepted position.

The response also carries the current logical `ConversationComputer` projection. The adapter opens
no WebSocket, receives no sandbox credential, and does not submit messages; participant messages use
the workspace adapter's authenticated HTTP command.

## Public surface

- `OpenCraneConversationEventStream` implements the browser history port with the generated client.

## Boundary

The server session derives participant and silo identity. Malformed history is rejected before it
enters browser state, and retry never discards an already accepted projection.

## See also

- Port: [`../stream`](../stream/README.md)
- Workspace adapter: [`../workspace/adapter`](../workspace/adapter/README.md)
