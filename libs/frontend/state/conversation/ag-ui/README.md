# @opencrane/state/conversation/ag-ui — safe projected conversation state

> [frontend](../../../README.md) › [state](../../README.md) › conversation › ag-ui

## What it owns

This pure browser-state package turns the small, display-safe AG-UI event projection into message,
tool, run, and reconnect-cursor state. A future OpenCrane-authorised replay reader supplies the
events; this package never opens a connection, reads browser storage, or invents a conversation.

```
 server-authorised replay reader
             │ safe SSE records
             ▼
 ┌───────────────────────┐
 │  conversation/ag-ui   │  validate · fold · resume cursor
 └───────────────────────┘
             │ view state
             ▼
     green workspace feature
```

**In this flow:** a future authorised replay reader · the green workspace feature.

Malformed records fail closed. Exact replay cursors are ignored, while cursor ordering remains the
server reader's responsibility because SSE identifiers are opaque.

## Public surface

- `__DecodeAgUiSseRecord` — validates one complete projected SSE record.
- `__ReduceAgUiStream` / `__CreateAgUiStreamState` — builds immutable browser view state.
- `__AgUiResumeCursor` — returns the cursor for a future authorised reconnect.

## Boundary

This package consumes only `@opencrane/contracts`. It has no network client, approval command,
persistence, or Angular dependency.

## Dependency direction

Tagged `scope:web` and `type:state`: it may import shared contracts, never apps, backend domains, or
frontend features.

## See also

- Parent index: [state](../../README.md)
- Related boundary: [channel proxy](../../../../backend/channel-proxy/main/README.md)
