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
projected content and reconnect coordinates immediately. Tool attempts remain visibly failed when
the model retries; if a later attempt succeeds, the view becomes `recovered` while retaining the
ordered safe failure classifications.

Governed `opencrane.a2ui.v1` custom events are validated against the exact shared envelope,
three-operation vocabulary, and constrained upstream-backed catalogue. Surfaces are keyed by conversation,
run, message, and surface identity. Consecutive authoritative sequences append to one bounded,
materialized operation history so a newly mounted canvas can reconstruct the complete surface;
same-sequence mutation, regression, and gaps fail closed. The reducer stores the server-selected ten-state
lifecycle and display-safe reason without inferring action authority or a next state locally.

The supported AG-UI packages are exact-pinned together at `@ag-ui/core` **0.0.57** and
`@ag-ui/client` **0.0.57**; both are MIT-licensed upstream packages. The OpenCrane projection
version remains `opencrane.ag-ui.v1`. Conformance tests drive the actual pinned `AbstractAgent`
lifecycle through completion, tool calls, approval edits, denial, expiry, failure, cancellation,
A2UI, and reconnect/resume. Production transport deliberately remains the cookie-authorized
OpenCrane GET replay adapter: using the client's POST-oriented `HttpAgent` would create a second run
and command path outside OpenCrane authority. The generic client resolves `RUN_ERROR` delivery, so
this reducer remains the explicit owner of failed versus cancelled browser state.

## Public surface

- `__DecodeAgUiSseRecord` — validates one complete record with pinned `@ag-ui/core` schemas and is
  exercised through the matching pinned `@ag-ui/client` lifecycle.
- `__ReduceAgUiStream` / `__CreateAgUiStreamState` — builds immutable browser view state while
  preserving truthful success, interruption, failure, and cancellation terminals, display-safe
  tool-failure classifications, plus monotonic governed A2UI surfaces.
- `__AgUiResumeCursor` — returns only the latest durable server cursor for reconnect.
- `__RevokeAgUiStreamAccess` — purges all projected content and reconnect coordinates after access loss.
- `AgUiRunStatuses` / `AgUiMessageStatuses` / `AgUiToolStatuses` — the browser's explicit projection lifecycle.

## Boundary

This package consumes only `@opencrane/contracts`. It has no network client, approval command,
persistence, or Angular dependency.

## Dependency direction

Tagged `scope:web` and `type:state`: it may import shared contracts, never apps, backend domains, or
frontend features.

## See also

- Parent index: [state](../../README.md)
- Related boundary: [channel proxy](../../../../backend/channel-proxy/main/README.md)
