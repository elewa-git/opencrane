# @opencrane/state/conversation/ag-ui — safe projected conversation state

> [frontend](../../../README.md) › [state](../../README.md) › conversation › ag-ui

## What it owns

This pure browser-state package turns the exact-pinned, display-safe AG-UI event projection into
message, tool, run, governed A2UI surface, interrupt, and reconnect-cursor state. The OpenCrane conversation event adapter
supplies complete SSE records incrementally; this package never opens a connection, reads browser
storage, or invents conversation authority.

```
 server-authorised event stream
             │ safe SSE records
             ▼
 ┌───────────────────────┐
 │  conversation/ag-ui   │  validate · fold · resume cursor
 └───────────────────────┘
             │ view state
             ▼
     green workspace feature
```

**In this flow:** the live [conversation event adapter](../adapter/README.md) · the green workspace
feature.

Malformed records and invalid lifecycle sequences fail closed. Exact duplicate cursors are ignored;
a duplicate cursor carrying different data is rejected. Cursorless open-interrupt overlays replace
the current interrupt set without advancing the durable cursor. An access-revoked overlay purges all
projected content and reconnect coordinates immediately.

Governed `opencrane.a2ui.v1` custom events are validated against the exact shared envelope,
three-operation vocabulary, and nine-name upstream catalogue. Surfaces are keyed by conversation,
run, message, and surface identity. Higher authoritative sequences replace their prior projection;
same-sequence mutation and regression fail closed. The reducer stores the server-selected ten-state
lifecycle and display-safe reason without inferring action authority or a next state locally.

## Public surface

- `__DecodeAgUiSseRecord` — validates one complete record with pinned `@ag-ui/core` schemas.
- `__ReduceAgUiStream` / `__CreateAgUiStreamState` — builds immutable browser view state while
  preserving truthful success, interruption, failure, and cancellation terminals plus monotonic
  governed A2UI surfaces.
- `__AgUiResumeCursor` — returns only the latest durable server cursor for reconnect.
- `__RevokeAgUiStreamAccess` — purges all projected content and reconnect coordinates after access loss.
- `AgUiRunStatuses` / `AgUiMessageStatuses` — the browser's explicit projection lifecycle.

## Boundary

This package consumes only `@opencrane/contracts`. It has no network client, approval command,
persistence, or Angular dependency.

## Dependency direction

Tagged `scope:web` and `type:state`: it may import shared contracts, never apps, backend domains, or
frontend features.

## See also

- Parent index: [state](../../README.md)
- Related boundary: [channel proxy](../../../../backend/channel-proxy/main/README.md)
