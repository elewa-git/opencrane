# @opencrane/state/conversation/adapter — canonical conversation replay reader

> [frontend](../../../README.md) › [state](../../README.md) › conversation › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend).
This package reads a signed-in participant's already-authorised, display-safe conversation history
from the canonical replay API. It does not open an agent-runtime connection, mint a pod credential,
or submit a chat command: those concerns belong to the owned execution boundary, not the browser.

Reading a thread sends one cookie-session request to
`GET /api/v1/me/conversations/:threadId/events`. The server derives the caller and silo from the
session, applies participant membership, and returns bounded AG-UI server-sent events (SSE). The
reader validates every record with the shared AG-UI state package before reducing it into browser
view state.

```
 green conversation feature
        │ asks for one authorised replay
        ▼
 OpenCraneConversationReplayReader  ◄── HERE
        │ GET /me/conversations/:threadId/events
        ▼
 conversation/ag-ui ......... validates + reduces safe SSE records
```

**In this flow:** [conversation/ag-ui](../ag-ui/README.md) · the green conversation feature.

Invariant: an invalid replay record fails the read rather than being rendered as inferred content.
The cursor is opaque and is returned only by the server, so the browser never invents order or
authorization state.

## Public surface

- `OpenCraneConversationReplayReader` — the cookie-session reader for one canonical thread replay.
- `__ReadConversationReplay` — validates and reduces one finite AG-UI SSE body.
- `ConversationReplayReader` — the narrow reader contract for consumers that need a replaceable API seam.

## Boundary

Consumed directly by a green conversation feature or by a feature-owned provider. It depends on the
shared `ControlPlaneApiService` only for the session-bound generated API client, and delegates all
SSE validation to `conversation/ag-ui`. It deliberately does not list threads, cache messages,
maintain a socket, or expose agent commands.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here `conversation/ag-ui`, `@opencrane/core`, and Angular — never on apps or server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [conversation/ag-ui](../ag-ui/README.md) · [conversation/render](../render/README.md)
