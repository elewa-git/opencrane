# @opencrane/features/conversation-workspace — chats after onboarding

> [frontend](../../README.md) › [features](../README.md) › conversation-workspace

## What it owns

This package owns the normal workspace where a participant can open, create, read, and contribute
to direct, group, and Agent-session conversations. Its thin page composes the approved conversation,
asset, Activity and elicitation elements, plus its read-only A2UI display component. A component-scoped presenter derives browser-safe display
models and delegates every command to the existing state stores. Its feature-local route coordinator
owns index/selection URLs and sign-in recovery through the platform seam.
The existing creation dialog disables its choices during submission. A failed request keeps the
chosen assistant available for retry through the state store's retained creation command.

The completed onboarding exchange appears as the selected **Welcome** row inside the same **My sessions**
rail as ordinary conversations. It remains a separate read-only server projection, not a fourth conversation
mode, and starts no stream or run. Its main panel follows board `8a`: a compact completed/read-only header,
guide and participant dialogue, a completion divider, and one **Start a new chat** continuation tray. Directory
warnings explain unavailable Agent setup without inventing provisioning state in the browser.

An ordinary selected conversation may compose one feature-local context panel from the existing Activity,
Files, and Computer review components. The page owns whether that panel is open and restores keyboard focus
to the header trigger when it closes. Direct and group conversations show current-readable questions and
Files but never adopt stale personal-run Activity or an unavailable computer generation. PrimeNG tabs own Files and Computer review
selection and keyboard movement while the context component keeps that visual selection local.
Ready file intents pass through a feature-local coordinator: it reserves the platform-owned Preview
or Download action during the click, then asks the component-scoped asset state for authorized bytes.
Selection or access loss cancels the prepared action, and the state owner drops late bytes. The
feature never creates object URLs or upgrades the server's safe media disposition.
The shared composer mounts the PDF picker and attachment tray. A send freezes at most ten unique
ready asset ids into the same retry-stable message command. Failed or ambiguous sends keep the draft,
selection, and command key; while that exact retry is pending, the picker and selection controls stay
locked so the visible files remain the files that will be sent. Only a confirmed save clears that captured asset set. Processing files
remain visible and block submission until the bounded asset-state refresh observes Ready or Failed.

The rail's **Activity** action shows the number of current-readable questions awaiting a response.
It remains available on the chat index and completed onboarding history; those views open Activity
without Files. New questions update the count without opening the panel. The component-scoped
elicitation Activity store refreshes while the page is visible, immediately removes expired rows,
and clears private content on identity or access loss. The API decides which participant may read
or answer a question; the browser does not filter ordinary questions by their original assignee.

Personal chats also show recent work with readable statuses and a **Refresh activity**
control. The presenter merges both sources newest-first without exposing execution identifiers. **Open
answer** appears only when a completed agent answer for that run is rendered in the selected
transcript. The page checks that link again before focusing it, closes the narrow overlay and
respects reduced-motion preferences. **Answer** opens the authorized conversation and reads the exact
conversation/run/request from that Activity row before focusing its card. An unavailable target never
falls back to an unrelated older question. Company-assistant children use the same question navigation;
the personal-run index still does not claim complete shared tool history or run controls.

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
Immutable artifact blocks render through the existing asset card only when the current authorized
asset projection matches artifact id, artifact revision id, and message id. Missing or conflicting
coordinates produce a non-actionable unavailable card rather than a filename-based join.

### Read-only structured results

`a2ui/` reconstructs saved A2UI entries from the same authorized history and payload response.
The transcript places each display at its latest entry, keeping different conversations and stamped
author identities separate even when they choose the same `surfaceId`. Reconstruction starts empty
on every projection; the existing store's selection/access purge therefore drops all display content.
No renderer subscribes to events, reads private tool results, or requests additional data.

The history adapter admits `a2uiSchemaVersion: "0.8"` with a JSON **array** of the installed SDK's
`surfaceUpdate`, `beginRendering`, `dataModelUpdate` and `deleteSurface` messages per payload. This
array framing is shared with the server's final-answer producer. The dependency-neutral component,
root and update shapes live in `@opencrane/contracts`; the browser keeps its own replay and SDK
adaptation. The server produces only one complete literal-only Replace beside its ordinary answer,
while this history reader retains bounded patch and data-binding support. Accessible interactive
choices/forms and their server-owned action/audit path remain separate MVP work. Source wiring and
fixture checks do not prove a deployed producer or a real-account journey.

| Previous display | Replace | Patch | Remove / final deleteSurface |
| --- | --- | --- | --- |
| Absent or removed | Rebuild from empty | Unavailable; requires Replace | No row |
| Waiting or ready | Discard old content and rebuild | Apply to retained definitions/data | Discard content; no row |
| Invalid wire data or graph | Rebuild from empty | Remains unavailable | No row |

A valid but incomplete root, child or string binding shows Waiting without the previous tree.
Unsupported or malformed payloads/graphs show fixed Unavailable copy, never raw error or payload
text. A binding to a number or object is unavailable until a string update or Replace repairs it.
The adjacent strict validator refuses unknown fields, action/media/form components, remote/custom
catalogues, agent styles and template expansion. JSON-shaped `valueString` data is also refused:
the installed SDK otherwise parses it implicitly and can log malformed content. Use literal Text
for JSON-looking display text. Root data must be a map, while scalar updates require a named path.

The component catalogue contains escaped literal Text, Row, Column, Card and horizontal Divider.
All heading hints map to `h2` beneath the page-owned heading; no agent can create another page `h1`.
SDK ids are internally renamed to prevent its generic string resolver from treating literal text
as a child reference. Binding values are resolved once before rendering; raw definitions, unused
data and styles are removed from the public snapshot. Catalogue, theme and SDK infrastructure are
component-scoped. The host has one presentation input and no outputs or action handlers.

Browser work is limited to 64 KiB and 64 messages per payload; 512 KiB and 512 messages between
Replace entries; 256 stored/expanded components and 16 layout levels per display; and 4 MiB of
UTF-8 input per history projection. At most 32 non-removed display rows are retained, including
invalid ones, plus one fixed overflow notice. Remove frees a display slot; a skipped Patch still
needs a fresh Replace. The generic OpenCrane overflow notice stays for the remainder of that
replay, even if a skipped key is subsequently removed or deleted: forgetting one skipped key does
not prove that all earlier omitted history is now shown. The per-display table above does not
remove this history-limit notice. These are rendering/resource safeguards, not assistant reasoning limits.

A person can select their own posted group message and choose **Ask company assistant**. The picker
uses the server's permitted company-assistant directory; an empty directory explains that an
administrator must provision an assistant and grant access. It never substitutes the personal agent.
A separate participant picker starts with the requester included and no other person selected.
Only the explicitly selected people share the new assistant chat; the source group does not become
its audience automatically. The picker displays privacy-safe labels and returns opaque participant
references without deciding membership or permission.
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
reads, clears file state before changing conversations, and selects the current computer generation.
The elicitation coordinator owns selected-question discovery, global Activity activation, and exact-target
navigation. It clears the selected draft on identity or selection changes and cancels overtaken reads.
An approval log position invalidates the selected conversation's elicitation read; its approval id
is never treated as a request id. The coordinator re-lists current requests through the signed-in
API, while the independent Activity store owns visible-page refresh. The existing card keeps disclosure, decision, and terminal states out of
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
- `ConversationWorkspaceContextPanelComponent` composes closable Activity, Files, and Computer review
  presentation without owning state or navigation.
- `ConversationWorkspaceConnectionStatusComponent` places stream recovery status beside a reconnect
  intent. It displays only presenter-provided copy and never opens a history connection itself.
- `ConversationA2uiDisplayComponent` accepts a feature-local read-only snapshot or Waiting/Unavailable
  presentation. It never receives private payloads, resolves bindings or emits an action.
- The feature-local list and create controls render privacy-safe rows and immutable conversation mode
  choices. Each session row is one line: its prefix glyph communicates completed onboarding, Agent,
  direct, group, or closed state while selection changes only the row background. Completed onboarding
  and active chats share one session list; archived chats retain their semantic glyph in a dimmed group.
  Direct-chat titles use the other member’s display name. Group titles use the first two other
  members’ names and count the remainder. These labels come from the existing conversation directory;
  a missing member receives generic text. No row shows opaque participant references.
- `ConversationParticipantPickerComponent` is the controlled feature-local checkbox group reused by
  ordinary conversation creation and company-assistant subchat creation. It keeps the requester fixed
  when supplied, emits only opaque peer references, and owns no membership or submission authority.

## Boundary

This feature does not call HTTP, open or persist conversation connections, authorize participants, or decide
whether a message creates an Agent run. Those rules remain in the backend and typed state ports. Its
connection bar emits a reconnect intent; the workspace store owns the replacement history connection and preserves
the draft and accepted live projection. It never treats a display role as identity or upgrades a
private tool result into participant-visible data. A2UI actions remain unavailable because their
server-owned capability and audit path are not wired; the finite read-only subset above creates no
such authority.

The platform bridge is the sole owner of browser popup, anchor, and object-URL effects. The file
coordinator prepares that capability before awaiting the existing participant-authorized read and
reports blocked or expired actions through the current asset's local command state.

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
