# Elements — presentational component libraries

> [frontend](../README.md) › elements

An **element** package is a set of small, reusable pieces of UI — display components and the
Angular providers that power them — with no route and no business logic of its own. Features drop
elements into their screens; elements themselves know nothing about which feature is using them.

## Map

| Package | What it owns |
| --- | --- |
| [`a2ui`](./a2ui/README.md) | In-process A2UI canvas renderer. |
| [`ui`](./ui/README.md) | Shared presentational UI components. |

```
     features (screens)  ──imports──►  elements
                                       ├── ui    (buttons, tables, dialogs…)
                                       └── a2ui  (agent-authored canvases)
        elements import nothing sideways ──►
```

## Dependency rule for this tier

Elements carry `scope:web` and `type:ui`. They are imported **by** features but import nothing
sideways — no feature, no [`state`](../state/README.md) package. They may lean only on shared
contracts and their own presentational dependencies. This one-directional rule is what lets a
component be reused in any screen without dragging application state along with it. Never import a
backend package or an app.

## See also

- Parent index: [`libs/frontend`](../README.md)
- Sibling groups: [`libs/frontend/features`](../features/README.md) · [`libs/frontend/state`](../state/README.md)
