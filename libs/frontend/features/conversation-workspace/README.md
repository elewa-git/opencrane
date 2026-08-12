# @opencrane/features/conversation-workspace — chats after onboarding

> [frontend](../../README.md) › [features](../README.md) › conversation-workspace

## What it owns

This package owns the normal workspace where a participant can open, create, read, and contribute
to direct, group, and Agent-session conversations. Its thin page composes the approved conversation,
asset, Activity, elicitation, and A2UI elements. A feature presenter derives browser-safe display
models and delegates every command to the existing state stores. Its feature-local route coordinator
owns index/selection URLs, child Agent-thread navigation, and sign-in recovery through the platform seam.

The completed onboarding exchange appears first as a selected read-only history panel. It is not a fourth
conversation mode and starts no stream or run. Its composer is replaced by an explanation and a **Start a
new chat** action, which opens the same immutable-mode creation flow used everywhere else.

```
 bounded snapshot ──► workspace store ──► feature presenter ──► thin page
                           ▲                       │                 │
 shared live stream ───────┘                       └── typed intent ─┘
```

The snapshot remains canonical while the shared stream adds live messages, run state, tool
activity, files, questions, and approvals. A2UI surfaces are reported as unavailable until the server owns
their capability checks and audit trail. Tool failures stay visible even when a later attempt succeeds.

## Public surface

- `CONVERSATION_WORKSPACE_ROUTES` is the child route table the app mounts at `/chats`.
- `ConversationWorkspacePageComponent` is the composition shell. It emits exact navigation intents
  to the feature-local route coordinator.
- `ConversationWorkspacePresenter` maps store projections to shared element presentations and
  delegates typed user intents to the stores that own them.
- `ConversationOnboardingHistoryComponent` renders the completed bootstrap transcript without message,
  asset, run, archive, or close controls.
- The feature-local list and create controls render privacy-safe rows and immutable conversation
  mode choices. Active chats, archived chats, and onboarding history remain distinct sections, and they
  never show opaque participant references.

## Boundary

This feature does not call HTTP, persist conversations, authorize participants, start streams, or
decide whether a message creates an Agent run. Those rules remain in the backend and typed state
ports. It never treats a display role as identity and never renders secrets. A2UI returned by an
Agent remains unavailable in this phase because its actions have no server-owned capability or audit path.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:feature-shell`. It may compose
approved elements, conversation features, and conversation state. It must not import an app,
backend package, or concrete generated-client adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/workspace`](../../state/conversation/workspace/README.md)
- Generated-client adapter: [`state/conversation/workspace/adapter`](../../state/conversation/workspace/adapter/README.md)
- Shared live projection: [`state/conversation/adapter`](../../state/conversation/adapter/README.md)
