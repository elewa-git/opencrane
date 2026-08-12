# @opencrane/features/conversation-workspace — chats after onboarding

> [frontend](../../README.md) › [features](../README.md) › conversation-workspace

## What it owns

This package owns the normal workspace where a participant can open, create, read, and contribute
to direct, group, and Agent-session conversations. Its thin page composes the approved conversation,
asset, Activity, elicitation, and A2UI elements. A feature presenter derives browser-safe display
models and delegates every command to the existing state stores.

```
 bounded snapshot ──► workspace store ──► feature presenter ──► thin page
                           ▲                       │                 │
 shared live stream ───────┘                       └── typed intent ─┘
```

The snapshot remains canonical while the shared stream adds live messages, run state, tool
activity, files, questions, approvals, and display-only A2UI surfaces. Tool failures stay visible
even when a later attempt succeeds.

## Public surface

- `ConversationWorkspacePageComponent` is the route-ready composition shell. It emits exact child
  Agent-thread navigation coordinates and does not own browser navigation.
- `ConversationWorkspacePresenter` maps store projections to shared element presentations and
  delegates typed user intents to the stores that own them.
- The feature-local list and create controls render privacy-safe rows and immutable conversation
  mode choices. They never show opaque participant references.

## Boundary

This feature does not call HTTP, persist conversations, authorize participants, start streams, or
decide whether a message creates an Agent run. Those rules remain in the backend and typed state
ports. It never treats a display role as identity and never renders secrets. A2UI returned by an
Agent is deliberately display-only in this phase.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:feature-shell`. It may compose
approved elements, conversation features, and conversation state. It must not import an app,
backend package, or concrete generated-client adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/workspace`](../../state/conversation/workspace/README.md)
- Generated-client adapter: [`state/conversation/workspace/adapter`](../../state/conversation/workspace/adapter/README.md)
- Shared live projection: [`state/conversation/adapter`](../../state/conversation/adapter/README.md)
