# @opencrane/elements/a2ui — governed interactive surfaces

> [frontend](../../README.md) › [elements](../README.md) › a2ui

## What it owns

This frontend element renders a display-safe A2UI (Agent-to-User Interface) surface inside a
conversation. The conversation state layer first decodes and validates the server projection;
this package then preserves the supplied operation order and renders one stable surface identity.

```
 authorized conversation projection
          │  typed presentation + ordered operations
          ▼
 ┌──────────────────────────────────┐
 │  <wo-a2ui-canvas>  ◄── HERE       │  render exact eleven-component catalogue
 └──────────────────────────────────┘
          │  coordinate-bound displayed action intent
          ▼
 authenticated server command path ........ reconstructs authority and accepts or denies
```

**In this flow:** the conversation projection and authenticated command path remain outside this
presentational package.

The catalogue admits exactly Text, Button, TextField, SingleChoice, MultipleChoice, Select, Slider,
DateTimeInput, Image, Card, and List. The three choice contracts map to the upstream MultipleChoice
shape. Unknown or malformed components fail closed to a generic unsupported placeholder without
echoing payload data. Stable component ids preserve focus during progressive updates.

## Public surface

- `A2uiCanvasComponent` (`<wo-a2ui-canvas>`) — consumes one `A2uiSurfacePresentation` and emits one
  `A2uiDisplayedActionIntent` without exposing upstream completion subjects or raw events.
- `provideOpenCraneA2ui(sanitizer)` — registers the constrained catalogue, theme, and browser-owned
  safe markdown-to-HTML port.
- `A2uiSurfacePresentation` and `A2uiDisplayedActionIntent` — the finite display contract shared
  with the host. Envelope version, operations, and lifecycle state use the canonical
  `AG_UI_A2UI_ENVELOPE_VERSION`, `AgUiA2uiOperation`, and `AgUiA2uiSurfaceStates` contracts.

## Boundary

This package renders; it does not fetch events, authorize actions, resume runs, or infer completion.
Only `ready` surfaces emit action intent. The intent contains display coordinates, a displayed action
id, and bounded scalar values; the server remains responsible for identity, expiry, one-use checks,
audit, and command execution. Agent-authored text reaches HTML only through the injected sanitizer.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, and `scope:web`. It depends on Angular and the directly pinned
upstream A2UI renderer, but never imports frontend state, a feature package, backend code, or app
source.

## See also

- Parent index: [elements](../README.md)
- Sibling: [ui](../ui/README.md)
- Frontend architecture map: [frontend](../../README.md)
