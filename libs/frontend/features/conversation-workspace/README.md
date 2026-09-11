# @opencrane/features/conversation-workspace — chats after onboarding

> [frontend](../../README.md) › [features](../README.md) › conversation-workspace

## What it owns

This package owns the normal workspace where a participant can open, create, read, and contribute
to direct, group, and Agent-session conversations. Its thin page composes the approved conversation,
asset, Activity, elicitation, and A2UI elements. A component-scoped presenter derives browser-safe display
models and delegates every command to the existing state stores. Its feature-local route coordinator
owns index/selection URLs and sign-in recovery through the platform seam.
The existing creation dialog disables its choices during submission. A failed request keeps the
chosen assistant available for retry through the state store's retained creation command.

The completed onboarding exchange appears as the selected **Welcome** row inside the same **My sessions**
rail as ordinary conversations. It remains a separate read-only server projection, not a fourth conversation
mode, and starts no stream or run. Its main panel follows board `8a`: a compact completed/read-only header,
guide and participant dialogue, a completion divider, and one **Start a new chat** continuation tray. Directory
warnings explain unavailable Agent setup without inventing provisioning state in the browser.

An ordinary selected conversation may compose one feature-local context panel from the existing Activity and
Files components. The page owns whether that panel is open and restores keyboard focus to the header trigger
when it closes. Direct and group conversations can expose Files but never adopt stale Agent-run Activity.

Personal chats show **Recent activity** with readable work statuses and a **Refresh activity**
control. The presenter maps the personal-run store without exposing execution identifiers. **Open
answer** appears only when a completed agent answer for that run is rendered in the selected
transcript. The page checks that link again before focusing it, closes the narrow overlay and
respects reduced-motion preferences. Company-assistant children keep their existing shared-chat
surface; this personal index does not claim complete tool history or run controls.

The newest caller-owned run in a personal chat appears above the controlled composer through the
existing conversation run-action element. Active work offers **Stop**. Submission keeps a pending
state visible until the run read reports cancellation or another terminal state. If an accepted
message remains unconfirmed after one minute, the participant can explicitly try a new Stop.
An ambiguous HTTP submission retains its original UUID. Stop errors stay with the chat and run
that produced them. The feature mapper
exposes no run coordinate. Shared company children do not render this control because their current
projection does not prove which participant requested the run.

```
 bounded snapshot ──► workspace store ──► feature presenter ──► thin page
                           ▲                       │                 │
 shared live stream ───────┘                       └── typed intent ─┘
```

KurrentDB history remains canonical while the shared SSE adapter adds immutable messages and current
logical computer state. Resolved private payload text comes only from the authorized history response. The
workspace does not reconstruct AG-UI frames or expose run, tool, or sandbox commands.

The selected transcript also renders the latest canonical lifecycle fact for each visible tool call.
Requested, running, completed, failed, cancelled, and recovery-required facts use the shared conversation
status line. A completed result remains separate from the assistant's later answer and grants no download,
retry, or execution control. Repeated facts for one call coalesce at the newest history position, and neither
tool-call coordinates, result coordinates, arguments, nor result payloads enter the presentation. This same
history contract applies to personal Agent sessions and shared company-child chats; personal Recent activity
remains a separate private run index.

A person can select their own posted group message and choose **Ask company assistant**. The picker
uses the server's permitted company-assistant directory; an empty directory explains that an
administrator must provision an assistant and grant access. It never substitutes the personal agent.
A child request shows Preparing, a link to the ready conversation, or Unavailable. The ready child
opens in this workspace with **Back to group**. A completed assistant response offers an editable
review and **Share as my message**, so the group receives the human's confirmed text.

The feature-local request, message-action, and share components compose the existing ChoiceCardGroup
and PrimeNG controls. The separate group-child store owns reads, retry UUIDs, reviewed drafts, and
selection/abort fences; the presenter maps eligible sources using the verified session subject and
server-stamped message author. The page owns composition and existing navigation intents. Storybook
covers the choice, empty, pending, retry, ready-child, and accepted-share states, including a narrow
request dialog. None of these presentation hints replace server source or permission checks.

The page injects its presenter through composition. A separate selection coordinator starts initial
reads, clears file and elicitation state before changing conversations, and selects the current computer generation.
An approval log position invalidates the selected conversation's elicitation read; its approval id
is never treated as a request id. The coordinator re-lists current requests through the signed-in
API without polling, while the existing card keeps disclosure, decision, and terminal states out of
the routed page markup.
Pure status mappers derive composer and connection states. Each service is provided on the page,
so navigating away destroys its effects and all selected-conversation state with it.

Creation closes when loading or access loss replaces the ready workspace. Its local visibility
is reset, so reloading cannot reopen a stale modal over the access-change explanation.

## Public surface

- `CONVERSATION_WORKSPACE_ROUTES` is the child route table the app mounts at `/chats`.
- `ConversationWorkspacePageComponent` is the composition shell. It emits exact navigation intents
  to the feature-local route coordinator.
- Internal header, transcript and composer components own separate typed presentation contracts.
  The header restores context-trigger focus, the transcript owns message anchors and canonical tool-status rows, the page-owned
  conversation body scrolls messages and participant requests together,
  and the composer emits draft/send/reconnect intents. They reuse the established conversation elements.
- `ConversationOnboardingHistoryComponent` renders the completed bootstrap transcript without message,
  asset, run, archive, or close controls.
- `ConversationWorkspaceContextPanelComponent` composes closable Activity and Files presentation without
  owning state or navigation.
- `ConversationWorkspaceConnectionStatusComponent` places stream recovery status beside a reconnect
  intent. It displays only presenter-provided copy and never opens a history connection itself.
- The feature-local list and create controls render privacy-safe rows and immutable conversation mode
  choices. Each session row is one line: its prefix glyph communicates completed onboarding, Agent,
  direct, group, or closed state while selection changes only the row background. Completed onboarding
  and active chats share one session list; archived chats retain their semantic glyph in a dimmed group.
  Direct-chat titles use the other member’s display name. Group titles use the first two other
  members’ names and count the remainder. These labels come from the existing conversation directory;
  a missing member receives generic text. No row shows opaque participant references.

## Boundary

This feature does not call HTTP, open or persist conversation connections, authorize participants, or decide
whether a message creates an Agent run. Those rules remain in the backend and typed state ports. Its
connection bar emits a reconnect intent; the workspace store owns the replacement history connection and preserves
the draft and accepted live projection. It never treats a display role as identity and never renders
secrets. A2UI returned by an Agent remains unavailable in this phase because its actions have no
server-owned capability or audit path.

Agent sessions with an active computer compose a bounded review pane for files, diffs, allowlisted
commands, private browser pages and screenshots, and allowlisted localhost previews.

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
