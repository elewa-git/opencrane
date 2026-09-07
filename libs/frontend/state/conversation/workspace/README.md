# @opencrane/state/conversation/workspace — conversation screen state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › workspace

## What it owns

This package owns the browser state for the normal conversation screen. It loads conversation metadata,
then polls immutable Kurrent history through the shared history port. It keeps direct, group, and Agent
session modes separate and immutable, holds controlled drafts, and owns list, open, create, authenticated
HTTP message submission, archive, and close command state. It also reads the completed onboarding
exchange as a separate read-only projection; that projection never receives a conversation mode or stream.

```
generated API ──► workspace/adapter ──► gateway port ──► workspace stores  ◄── HERE
WebSocket events + messages ──► adapter ──► conversation/stream port ─────┘
                                                        │ safe state
                                                        ▼
                                               conversation-workspace feature
```

**In this flow:** the generated HTTP adapter · the shared event stream · the conversation workspace feature

`ConversationWorkspaceStore` owns conversation selection, metadata loading, history-poll recovery,
creation choices, and conversation commands. Current computer lifecycle comes from the history response;
the browser no longer reconstructs or controls a separate run lifecycle.
The store keeps a personal-session creation UUID after a failed response so retry opens the same
session. A successful response clears that command; the next creation receives a new UUID. Creation
choices stay fixed while the request is in flight and become editable again after failure.

## Public surface

The package also owns the Zod response validators used by its transport adapter. Keeping runtime acceptance beside the workspace models means HTTP code only authenticates and transports data; it does not rebuild the domain shape.

- `ConversationWorkspaceGateway` is the participant-scoped read and command port.
- `CONVERSATION_WORKSPACE_EVENT_STREAM` binds the existing `ConversationEventStream` port for both live
  projection and participant message submission; this package does not define a second transport contract.
- `ConversationWorkspaceStore` owns ordinary list, selection, snapshot-tail state, immutable creation mode,
  drafts, conversation commands, reconnect attempts, and a guarded manual reconnect. It preserves the
  draft and accepted live projection while fencing late updates from the replaced socket.
- Conversation summaries retain the server's decimal `readThroughPosition`, and messages retain
  `completedAt`; strict validation accepts both response fields without giving browser state authority
  to advance the participant coordinate or complete a message.
- `ConversationOnboardingHistoryStore` keeps the optional transcript read and selection independent from
  ordinary snapshot, stream, draft, and run state.
- `ConversationRunStore` owns run status and exact-attempt run commands.
- `ConversationComputerReviewStore` owns file, diff, command, browser, screenshot, and localhost
  preview requests, purges output on selection changes, and rejects late results.
- `ConversationOnboardingHistoryStatuses` distinguishes a completed transcript, unfinished onboarding,
  migrated accounts without recorded history, and a temporary read failure without blocking normal chats.
- Exported enums and view models are transport-neutral and contain no login subjects, emails, roles, or
  memory identity.

## Boundary

Opaque participant references are command coordinates, never labels. The state supplies those privacy-safe
references, a self marker, and server-selected member display names. The directory validator labels
the signed-in member `You` and preserves other display names; it rejects extra login-subject and email fields. On proven access loss, selected
history and drafts are cleared before the access-changed state becomes visible.

The package owns no server authority. It cannot admit a message, start a computer, or decide whether a
retry is safe. Those decisions stay behind signed-in APIs.
The onboarding transcript is disabled by construction: selecting it aborts any conversation history poll,
clears the draft, and offers only the existing create-conversation command for continuing work.

## Dependency direction

The package carries `scope:conversation-workspace` and `frontend-role:state-composite`. It depends on the
existing conversation history-stream port, but never on a concrete HTTP adapter, feature,
element, backend package, or app. The generated-client implementation lives in [`adapter`](./adapter/README.md).

## See also

- Parent index: [`libs/frontend/state/conversation`](../README.md)
- Transport adapter: [`workspace/adapter`](./adapter/README.md)
- Shared stream contract: [`conversation/stream`](../stream/README.md)
- Live HTTP implementation: [`conversation/adapter`](../adapter/README.md)
