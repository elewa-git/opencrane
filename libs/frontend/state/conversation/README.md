# Conversation browser state

> [frontend](../../README.md) › [state](../README.md) › conversation

This directory groups browser-owned conversation projections and commands. These packages consume
authenticated APIs and hold component-scoped UI state; they do not own conversations, runs,
participants, assets, elicitation, or access decisions.

| Package | Responsibility |
|---------|----------------|
| [`adapter`](./adapter/README.md) | Generated-client translation for canonical conversation replay. |
| [`ag-ui`](./ag-ui/README.md) | Safe projected-event state for A2UI surfaces. |
| [`agent-threads`](./agent-threads/README.md) | Child Agent-session route state, follow-up commands, and access purge. |
| [`assets`](./assets/README.md) | Upload, retry, and safe attachment lifecycle state. |
| [`elicitation`](./elicitation/README.md) | Recoverable question and approval state plus Activity mapping. |
| [`render`](./render/README.md) | Vendored conversation render view-models. |

## Boundary

Keep generated-client adapters at this browser boundary. State packages expose dependency-neutral
ports to features, validate responses before adoption, and discard child data as soon as the server
reports lost access. They never infer participant visibility or reveal whether an unavailable child
exists.

## See also

- Parent index: [`libs/frontend/state`](../README.md)
- Feature index: [`libs/frontend/features`](../../features/README.md)
- Presentational elements: [`libs/frontend/elements`](../../elements/README.md)
