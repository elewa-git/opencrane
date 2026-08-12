# @opencrane/state/conversation/workspace — conversation screen state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › workspace

## What it owns

This package owns the browser state for the normal conversation screen. It loads a bounded snapshot,
then tails the shared conversation event stream from that snapshot. It keeps direct, group, and Agent
session modes separate and immutable, holds controlled drafts, and owns list, open, create, send,
archive, close, steering, cancellation, and retry command state.

```
 generated API ──► workspace/adapter ──► gateway port ──► workspace stores  ◄── HERE
 live event API ──► conversation/adapter stream port ──┘
                                                        │ safe state
                                                        ▼
                                               conversation-workspace feature
```

**In this flow:** the generated HTTP adapter · the shared event stream · the conversation workspace feature

`ConversationWorkspaceStore` owns conversation selection, snapshot-first loading, live reconnect state,
creation choices, and conversation commands. `ConversationRunStore` separately owns run status and the
steer, cancel, and retry controls. The split keeps ordinary chat commands independent from Agent-run state.

## Public surface

- `ConversationWorkspaceGateway` is the participant-scoped read and command port.
- `CONVERSATION_WORKSPACE_EVENT_STREAM` binds the existing `ConversationEventStream` port; this package
  does not define a second stream contract.
- `ConversationWorkspaceStore` owns list, selection, snapshot-tail state, immutable creation mode, drafts,
  and conversation commands.
- `ConversationRunStore` owns run status and exact-attempt run commands.
- Exported enums and view models are transport-neutral and contain no login subjects, emails, roles, or
  memory identity.

## Boundary

Opaque participant references are command coordinates, never labels. The state maps the signed-in entry to
`You` and other people to stable generic labels such as `Participant 1`; it never interprets an opaque
reference. On proven access loss, selected messages, live surfaces, run state, and drafts are cleared before
the access-changed state becomes visible.

The package owns no server authority. It cannot admit a message, create a run, approve an elicitation,
execute an A2UI action, or decide whether a retry is safe. Those decisions stay behind signed-in APIs.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:state-composite`. It depends on the
existing conversation event-stream port and AG-UI state, but never on a concrete HTTP adapter, feature,
element, backend package, or app. The generated-client implementation lives in [`adapter`](./adapter/README.md).

## See also

- Parent index: [`libs/frontend/state/conversation`](../README.md)
- Transport adapter: [`workspace/adapter`](./adapter/README.md)
- Shared live stream: [`conversation/adapter`](../adapter/README.md)
- Agent threads: [`conversation/agent-threads`](../agent-threads/README.md)
