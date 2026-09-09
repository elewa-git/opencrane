# @opencrane/state/conversation/workspace — conversation screen state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../README.md) › workspace

## What it owns

This package owns the browser state for the normal conversation screen. It loads conversation metadata,
then follows immutable Kurrent history through the shared history port. It keeps direct, group, and Agent
session modes separate and immutable, holds controlled drafts, and owns list, open, create, authenticated
HTTP message submission, archive, and close command state. It also reads the completed onboarding
exchange as a separate read-only projection; that projection never receives a conversation mode or stream.

```
generated API ──► workspace/adapter ──► gateway port ──► workspace stores  ◄── HERE
SSE history events ──► adapter ──► conversation/stream port ─────┘
                                                        │ safe state
                                                        ▼
                                               conversation-workspace feature
```

**In this flow:** the generated HTTP adapter · the shared event stream · the conversation workspace feature

`ConversationWorkspaceStore` owns conversation selection, metadata loading, history-connection recovery,
creation choices, and conversation commands. Current computer lifecycle comes from the history stream;
the browser no longer reconstructs or controls a separate run lifecycle.
The store keeps a creation UUID after a failed response so retry opens the same conversation
in every mode. A changed member set receives a new command UUID. A successful response clears that command; the next creation receives a new UUID. Creation
choices stay fixed while the request is in flight and become editable again after failure.
The package-local creation-command helper compares selections and builds commands; the store owns
the pending command's lifetime and clears it after success, an explicit mode change or proven access loss.

Proven access loss from a workspace read, command or event stream erases the conversation list,
creation directory, selected history, draft and onboarding transcript. It also clears pending creation
state and rejects older read and command results. Switching between authorized chats preserves an
in-flight creation: its result can update the list but cannot navigate away from the new selection.
Replacing a stream releases interrupted command controls without letting their late completions
change a newer command. The server checks live subscription authority every ten seconds; clearing
browser state follows that signal or the next denied product request. The event adapter owns history and computer delivery; the workspace reads metadata when a chat opens,
so newly created children and direct links do not depend on an already-loaded list.

`ConversationGroupChildStore` owns requests made from an existing group message and the editable
review before a human shares an assistant result. It retains UUIDs for unchanged retries, locks
input while submitting, and aborts and purges request/share state when selection or access changes.
Pending creation is refreshed every five seconds for at most one minute; the participant can then
refresh explicitly. Ready means the child can open, not that the assistant finished its work.

`ConversationPersonalRunsStore` reads the signed-in person's recent work through a separate narrow
port. It filters the API's latest 50 entitled runs to the selected personal chat, so an empty list
does not promise that no older work exists. Selection, identity, access and history checkpoints
invalidate the read; cancelled or late responses cannot restore an earlier selection. Active work
and inputs awaiting admission refresh every five seconds for up to one minute, then require an
explicit refresh. Failed reads clear rows; access denial stops retries until the chat is reopened.
This store reads status and never starts, cancels or retries assistant execution.

## Public surface

The package also owns the Zod response validators used by its transport adapter. Keeping runtime acceptance beside the workspace models means HTTP code only authenticates and transports data; it does not rebuild the domain shape.

- `ConversationWorkspaceGateway` is the participant-scoped read and command port.
- `ConversationGroupChildStore` and `CONVERSATION_GROUP_CHILD_GATEWAY` own explicit company-assistant
  requests, current child lists, and reviewed human shares. Shared child model validators and strict
  response-envelope validators reject foreign source/parent coordinates before state adoption.
- `CONVERSATION_WORKSPACE_EVENT_STREAM` binds the existing `ConversationEventStream` port for live
  projection; this package does not define a second transport contract.
- `ConversationWorkspaceStore` owns ordinary list, selection, snapshot-tail state, immutable creation mode,
  drafts, conversation commands, reconnect attempts, and a guarded manual reconnect. It preserves the
  draft and accepted live projection while fencing late updates from the replaced connection.
- Conversation summaries retain the server's decimal `readThroughPosition`, and messages retain
  `completedAt`; strict validation accepts both response fields without giving browser state authority
  to advance the participant coordinate or complete a message.
- `ConversationOnboardingHistoryStore` keeps the optional transcript read and selection independent from
  ordinary snapshot, stream, draft, and run state.
- `ConversationComputerReviewStore` owns file, diff, command, browser, screenshot, and localhost
  preview requests, purges output on selection changes, and rejects late results.
- `ConversationOnboardingHistoryStatuses` distinguishes a completed transcript, unfinished onboarding,
  migrated accounts without recorded history, and a temporary read failure without blocking normal chats.
- Command and view models are transport-neutral and contain no login subjects, emails, roles, or
  memory identity. `CONVERSATION_CURRENT_SUBJECT` is a separate host-supplied signal used only to
  present actions for the current person's messages; it never supplies command identity.

## Boundary

Opaque participant references are command coordinates, never labels. The state supplies those privacy-safe
references, a self marker, and server-selected member display names. The directory validator labels
the signed-in member `You` and preserves other display names; it rejects extra login-subject and email fields. On proven access loss, retained
workspace content and drafts are cleared before the access-changed state becomes visible.

The package owns no server authority. It cannot admit a message, start a computer, or decide whether a
retry is safe. Those decisions stay behind signed-in APIs.
The onboarding transcript is disabled by construction: selecting it aborts any conversation history connection,
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
