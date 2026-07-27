# Features — routed UI slices

> [frontend](../README.md) › features

A **feature** is one slice of the app's screen: a routed page or a pane, plus the components that
fill it. Most are **lazy-loaded** — the browser only downloads a feature's code the first time its
route is opened, so the app starts small. Each feature exports the component the shell drops into
its slot; the shell itself is `workspace`.

## Map

| Package | What it owns |
| --- | --- |
| [`context`](./context/README.md) | The right-hand context pane. |
| [`conversation`](./conversation/README.md) | The centre conversation pane. |
| [`metrics`](./metrics/README.md) | The AI-usage metrics dashboard. |
| [`notifications`](./notifications/README.md) | The notification popover. |
| [`settings`](./settings/README.md) | The settings page. |
| [`tools`](./tools/README.md) | Tools and tool-governance routes. |
| [`welcome`](./welcome/README.md) | First-run onboarding. |
| [`workspace`](./workspace/README.md) | The workspace shell. |

```
                       workspace (the shell)
         ┌──────────────┼───────────────┐
   conversation      context        notifications
   (centre pane)   (right pane)      (bell popover)
         │
   routed pages: metrics · settings · tools · welcome
```

## Dependency rule for this tier

Features carry `scope:web` and `type:feature`. A feature may import presentational
[`elements`](../elements/README.md) and the [`state`](../state/README.md) layer (gateway ports and
adapters), plus shared contracts. It may **not** import a sibling feature — the one exception is
`workspace`, the shell, which composes the others. Cross-feature sharing goes down into `elements`
or `state`, never sideways. Never import a backend package or an app.

## See also

- Parent index: [`libs/frontend`](../README.md)
- Sibling groups: [`libs/frontend/elements`](../elements/README.md) · [`libs/frontend/state`](../state/README.md)
