# @opencrane/state/conversation/adapter — live conversation event stream

> [frontend](../../../README.md) › [state](../../README.md) › conversation › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend).
This package streams a signed-in participant's already-authorised, display-safe conversation
projection from the canonical event API. It does not open an agent-runtime connection, mint a pod
credential, or submit a chat command: those concerns belong to the owned execution boundary, not
the browser.

Opening a conversation sends a cookie-session request to
`GET /api/v1/me/conversations/:conversationId/events`. The server derives the caller and silo from the
session, applies participant membership, and returns bounded snapshot-then-live AG-UI server-sent
events (SSE). The adapter consumes the response `ReadableStream` incrementally and validates every
complete record with the shared AG-UI state package before publishing browser view state.
The backend [conversation projection package](../../../../backend/conversations/projection/main/README.md)
produces this one stream for direct, group and agent-session conversations.

```
 green conversation feature
        │ opens one authorised stream
        ▼
 OpenCraneConversationEventStream  ◄── HERE
        │ GET /me/conversations/:conversationId/events
        ▼
 conversation/ag-ui ......... validates + reduces safe SSE records
```

**In this flow:** [conversation/ag-ui](../ag-ui/README.md) · the green conversation feature.

The generated client keeps `credentials: include`, so the existing browser session authenticates
every reconnect. Bounded responses resume with the exact opaque cursor in both `cursor` and
`Last-Event-ID`; cursorless open-interrupt overlays never change it. Heartbeats and reconnect phases
are observable, caller abort is immediate, malformed frames fail closed, and access revocation
purges the reduced projection.

## Public surface

- `OpenCraneConversationEventStream` — cookie-session incremental snapshot-to-live adapter that
  implements the separate [`ConversationEventStream`](../stream/README.md) port.

## Boundary

Constructed only by app composition and consumed through the separate stream port. It depends on
the shared `ControlPlaneApiService` only for the session-bound generated API client, and delegates
all AG-UI record validation/reduction to `conversation/ag-ui`. It deliberately does not list
conversations, persist messages, interpret approval authority, or expose agent commands.

## Dependency direction

Tagged `scope:web`, `type:state`, and `frontend-role:adapter`: it may depend on the frontend core and
state contracts it adapts — here `conversation/ag-ui`, `@opencrane/core`, and Angular — never on
apps, feature packages, or server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [conversation/stream](../stream/README.md) · [conversation/ag-ui](../ag-ui/README.md) · [conversation/render](../render/README.md)
- Server producer: [conversation projection](../../../../backend/conversations/projection/main/README.md)
