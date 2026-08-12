# @opencrane/state/conversation/agent-threads — Agent-thread browser state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › agent-threads

## What it owns

This package owns the browser port, view models, and component-scoped store for a group chat's child
Agent conversation. A future generated-client adapter will translate the public OpenAPI contract into
these view models; the store then handles reads, reconnects, controlled drafts, idempotent follow-ups,
late-result fencing, and authoritative snapshot adoption.

```
 generated API adapter ── authorized snapshot ──► AgentThreadStore  ◄── HERE
                                                      │ view state
                                                      ▼
                                              agent-threads feature
                                                      │ typed intent
                                                      └──► gateway command
```

**In this flow:** the generated API adapter · [`agent-threads feature`](../../../features/agent-threads/README.md)

Run, conversation access, delivery recovery, and admission remain separate dimensions. A first-view
missing, foreign, or denied route is deliberately indistinguishable. When a previously authorized
view proves access changed, the store purges its snapshot, draft, cursor, filenames, and ask before it
exposes the `access_changed` route state.

## Public surface

- `AgentThreadGateway` is the dependency-neutral read and follow-up port.
- `AgentThreadStore` owns exact-route loading, reconnect, command fencing, drafts, and purging.
- The exported enums and view models define finite browser states without copying wire DTOs.
- `AgentThreadGatewayError` carries only browser-safe failure categories and copy.

## Boundary

There is deliberately no HTTP adapter in this package yet. The adapter must be generated from the
backend OpenAPI contract, not built from guessed request or response shapes. This package grants no
conversation, run, memory, or delivery authority.

## Dependency direction

The package carries `scope:agent-threads` and `frontend-role:state`. It may depend only on frontend
core, shared contracts or models, and utilities; it must not import a feature, element, backend
package, app, or concrete adapter.

## See also

- Parent index: [`libs/frontend/state/conversation`](../README.md)
- Siblings: [`conversation/ag-ui`](../ag-ui/README.md) · [`conversation/assets`](../assets/README.md) · [`conversation/elicitation`](../elicitation/README.md)
