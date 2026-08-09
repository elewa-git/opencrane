# @opencrane/elements/a2ui — in-process A2UI canvas renderer

> [frontend](../../README.md) › [elements](../README.md) › a2ui

## What it owns

This is a frontend **element** package — a small, reusable piece of UI plus its Angular
providers, with no route or business logic of its own. It renders **A2UI canvases**: A2UI (the
Agent-to-UI protocol, an Apache-2.0 spec from Google) lets an agent stream a small interactive
surface — text, buttons, form fields — that the browser draws live. This package is the **sink**
half of that feature: it takes the agent's canvas payload and draws it, and it hands the user's
clicks and field edits back out so the host can return them to the agent.

```
 agent canvas message  (A2UI payload: JSONL (newline-delimited JSON) / JSON array / parsed actions)
          │
          ▼
 ┌──────────────────────────────────┐
 │  <wo-a2ui-canvas>  ◄── HERE       │  parse → render surfaces → emit userAction
 └──────────────────────────────────┘
          │  userAction (button press · field change)
          ▼
 host returns the action to the agent  (canvas.action return path)
```

**In this flow:** [state/conversation/render](../../state/conversation/render/README.md) *(the
shared markdown + sanitisation pipeline A2UI text reuses)*

Invariant: each `<wo-a2ui-canvas>` owns its own message processor, so surfaces from one canvas
never leak into another; agent-authored text is routed through the same sanitisation pipeline as
the transcript, so a canvas can never inject unsafe HTML. The **producer** half (turning an agent
message part into a canvas card) is not wired yet — until it lands, this renderer is present but
intentionally unproduced.

## Public surface

- `provideOpenCraneA2ui()` — app-level providers (component catalogue, theme, shared markdown renderer);
  spread once into a route or app's `providers`.
- `A2uiCanvasComponent` (`<wo-a2ui-canvas>`) — renders a canvas payload and emits each `userAction`.
- `_ParseA2uiMessages(raw)` — tolerant parser accepting JSONL, a JSON array, or parsed actions.

## Boundary

The future workspace shell will call `provideOpenCraneA2ui()` on its lazy route so the vendored
(copied-in third-party code) A2UI code stays out of the initial bundle. No product route consumes
the provider yet because the canvas producer is intentionally unwired. This package only renders
and emits — it does not fetch canvas payloads or talk to the API; returning an action to the agent
is the host's job.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, and `scope:web` (the frontend dependency tier): it may import
only other `scope:web` packages and `scope:shared` contracts — never backend code or app source.
Its one internal dependency is `state/conversation/render` for the shared markdown pipeline.

## See also

- Parent index: [elements](../README.md)
- Sibling: [ui](../ui/README.md)
- Intended consumer: the future product workspace surface.
