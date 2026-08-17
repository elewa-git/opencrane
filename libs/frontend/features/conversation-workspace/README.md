# @opencrane/features/conversation-workspace — chats after onboarding

> [frontend](../../README.md) › [features](../README.md) › conversation-workspace

## What it owns

This package owns the normal workspace where a participant can open, create, read, and contribute
to direct, group, and Agent-session conversations. Its thin page composes the approved conversation,
asset, Activity, elicitation, and A2UI elements. A feature presenter derives browser-safe display
models and delegates every command to the existing state stores. Its feature-local route coordinator
owns index/selection URLs, child Agent-thread navigation, and sign-in recovery through the platform seam.

The completed onboarding exchange appears as the selected **Welcome** row inside the same **My sessions**
rail as ordinary conversations. It remains a separate read-only server projection, not a fourth conversation
mode, and starts no stream or run. Its main panel follows board `8a`: a compact completed/read-only header,
guide and participant dialogue, a completion divider, and one **Start a new chat** continuation tray. Directory
warnings explain unavailable Agent setup without inventing provisioning state in the browser.

An ordinary selected conversation may compose one feature-local context panel from the existing Activity and
Files components. The page owns whether that panel is open and restores keyboard focus to the header trigger
when it closes. Direct and group conversations can expose Files but never adopt stale Agent-run Activity.

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
- `ConversationWorkspaceContextPanelComponent` composes closable Activity and Files presentation without
  owning state or navigation.
- The feature-local list and create controls render privacy-safe rows and immutable conversation mode
  choices. Completed onboarding and active chats share one session list; archived chats remain separate.
  No row shows opaque participant references.

## Boundary

This feature does not call HTTP, persist conversations, authorize participants, start streams, or
decide whether a message creates an Agent run. Those rules remain in the backend and typed state
ports. It never treats a display role as identity and never renders secrets. A2UI returned by an
Agent remains unavailable in this phase because its actions have no server-owned capability or audit path.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:feature-shell`. It may compose
approved elements, conversation features and state, the directory's generic self label, shared
contracts and models, and the platform capability seam used for sign-in recovery. It must not
import an app, backend package, browser runtime implementation, or concrete generated-client
adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/workspace`](../../state/conversation/workspace/README.md)
- Generated-client adapter: [`state/conversation/workspace/adapter`](../../state/conversation/workspace/adapter/README.md)
- Shared stream contract: [`state/conversation/stream`](../../state/conversation/stream/README.md)
- Live HTTP implementation: [`state/conversation/adapter`](../../state/conversation/adapter/README.md)
