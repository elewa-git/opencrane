# @opencrane/state/conversation/adapter — live conversation event stream

> [frontend](../../../README.md) › [state](../../README.md) › conversation › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend).
This package streams a signed-in participant's already-authorised, display-safe conversation
projection from the canonical socket. It does not open an agent-runtime connection, mint a pod
credential, or expose execution authority to the browser.

Opening a conversation creates a same-origin WebSocket at
`/api/v1/me/conversations/:conversationId/socket`. The browser sends its existing cookie session
during the upgrade; the server restores that session, derives the caller and silo, and rechecks
participant membership before accepting the connection. The socket returns structured snapshot and
live AG-UI frames, then carries participant message commands and their idempotent acknowledgements.
The adapter validates every complete projection frame with the shared AG-UI state package before
publishing browser view state.
The backend [conversation projection package](../../../../backend/conversations/projection/main/README.md)
produces this one stream for direct, group and agent-session conversations.

```
 green conversation feature
        │ opens one authorised stream
        ▼
 OpenCraneConversationEventStream  ◄── HERE
        │ wss://.../me/conversations/:conversationId/socket
        ▼
 conversation/ag-ui ......... validates + reduces safe socket frames
```

**In this flow:** [conversation/ag-ui](../ag-ui/README.md) · the green conversation feature.

The browser sends its cookie session automatically for this same-origin upgrade. Bounded socket
connections resume with the exact opaque cursor in the URL; cursorless open-interrupt overlays never
change it. Heartbeats and reconnect phases are observable, caller abort is immediate, malformed
frames fail closed, and access revocation purges the reduced projection.

## Public surface

- `OpenCraneConversationEventStream` — cookie-session socket adapter that implements the separate
  [`ConversationEventStream`](../stream/README.md) port and submits participant messages.

## Boundary

Constructed only by app composition and consumed through the separate stream port. It delegates all
AG-UI record validation/reduction to `conversation/ag-ui`. It deliberately does not list
conversations, persist messages itself, interpret approval authority, or expose agent commands.

## Dependency direction

Tagged `scope:web`, `type:state`, and `frontend-role:adapter`: it may depend on the frontend state
contracts it adapts — here `conversation/ag-ui` and Angular — never on apps, feature packages, or
server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [conversation/stream](../stream/README.md) · [conversation/ag-ui](../ag-ui/README.md) · [conversation/render](../render/README.md)
- Server producer: [conversation projection](../../../../backend/conversations/projection/main/README.md)
