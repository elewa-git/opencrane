# Workspace and conversation user stories

## Feature intent

Provide the workspace where participants start, resume, and understand agent sessions, direct chats,
and group chats. The conversation and its ordered timeline are server-authoritative and recoverable;
the browser is a client, not the conversation ledger.

Current status: `API blocked` for the ordinary workspace journey. The onboarding-owned guided
exchange and bounded event replay are `API ready`; ordinary thread discovery, creation, prompt
submission, and live tail are missing.

## Onboarding-chat boundary

The `bootstrap.md` onboarding chat is a bounded pre-main-app exchange owned by the onboarding
workflow, not a browser-local demo thread and not ordinary workspace access. Its implemented
deterministic form pins the reviewed bootstrap source and approved persona, remains resumable, and
records ordered owner answers without minting AgentService, workspace, run, model, membership, or
memory authority. Its conclusion advances `UserOnboarding`; ordinary conversation events cannot
mark onboarding complete by themselves. The future model-driven form still requires those general
workspace authorities. The canonical workflow and routing states live in
[identity-and-onboarding.md](identity-and-onboarding.md).

## CON-01 — See my conversations

**As a** user, **I want** to see my conversations ordered by recent activity **so that** I can resume
work across devices.

Acceptance criteria:

- The list is server-backed and owner/participant scoped.
- Empty, loading, pagination, unavailable, and long-title states are defined.
- Conversation metadata does not rely on browser-local cache for authority.

Status: `API blocked`; there is no public thread-list endpoint.

## CON-02 — Start a mode-bound conversation

**As a** user, **I want** to create a conversation in one supported mode **so that** its behaviour is
authoritative before the first message or run.

Acceptance criteria:

- Conversation creation is idempotent or returns a single canonical conversation ID.
- The server derives the participant and silo.
- The immutable mode is `agent_session`, `direct`, or `group`; only an agent session binds an agent.
- Creation failure does not leave a local-only conversation that appears durable.

Status: `API blocked`; there is no public thread-create endpoint.

## CON-03 — Send input to an agent session

**As a** user, **I want** to submit a message in a conversation **so that** my personal agent can
perform a governed run.

Acceptance criteria:

- The user sees queued, accepted, denied, capacity-limited, and unavailable outcomes.
- The admitted user message and its run commit atomically, and duplicate submission resolves to the
  same canonical result.
- A later ordinary question starts the next serial run; steering or elicitation answers target the
  active run and cannot bypass run authority.
- Attachments are included only after an authoritative upload/attachment contract exists.
- The browser never supplies silo, membership, persona, memory dataset, or tool authority.

Status: `API blocked`; run admission accepts an existing `threadId` but no public prompt/message
submission endpoint exists.

## CON-04 — Replay the canonical transcript

**As a** conversation participant, **I want** to replay canonical events from an opaque cursor **so
that** I can recover the display after refresh or reconnect.

Acceptance criteria:

- The client accepts SSE events in server order and persists only a resumable opaque cursor.
- Query cursor and `Last-Event-ID` conflicts are handled explicitly.
- Missing, foreign, wrongly nested, and never-authorized conversations return one non-disclosing
  unavailable response rather than an existence-bearing stream.
- Rendering supports typical, long, tool-related, approval-related, terminal, and malformed-safe
  display states.

API: `GET /api/v1/me/conversations/{threadId}/events`.

## CON-05 — Follow new events live

**As a** participant in an active run, **I want** new transcript events to appear as they happen **so
that** I can follow progress without manual refresh.

Acceptance criteria:

- Live delivery and finite historical replay have an explicit handoff.
- Reconnect does not duplicate or reorder events.
- The interface distinguishes connected, reconnecting, caught up, and terminal states.

Status: `API blocked`; the existing SSE endpoint is a finite bounded replay, not a live tail.

## CON-06 — Act on agent-rendered UI safely

**As a** user, **I want** to interact with agent-proposed UI controls **so that** structured tasks can
continue without granting the rendered component authority.

Acceptance criteria:

- Every action is returned through a typed, authenticated, run/conversation-bound public API.
- Disabled, expired, already-used, approval-required, and failed actions are finite states.
- A2UI rendering never performs privileged HTTP calls directly.

Status: `API blocked`; render primitives exist, but there is no public action-return protocol.

## CON-07 — Use immutable modes and mode-correct message admission

**As a** conversation participant, **I want** each chat to retain one mode **so that** ordinary
messages and agent work cannot silently cross authority boundaries.

Acceptance criteria:

- The persisted immutable mode is `agent_session`, `direct`, or `group`; only an agent session binds
  exactly one agent service.
- Every agent-session input goes through run admission, while ordinary direct and group messages
  never create `AgentRun` records.
- Message admission is participant-, silo-, join-boundary-, lifecycle-, and idempotency-bound.
- A single server-owned timeline sequence orders participant messages and linked run projections
  without deriving order from browser clocks.
- Unsupported mode commands fail closed.

Status: `API blocked`; no public ordinary-message admission or mixed conversation timeline exists.

## CON-08 — Join, read, close, and archive independently

**As a** participant, **I want** lifecycle, personal visibility, and access changes to stay distinct
**so that** a completed conversation cannot reopen and private history is not disclosed.

Acceptance criteria:

- Join visibility and unread position are durable participant-specific timeline coordinates.
- Close is monotonic and makes the conversation read-only; archive is a reversible participant-local
  list state.
- Completed onboarding appears as a closed/read-only conversation and can be archived independently.
- A revoked client purges child content, drafts, cursors, filenames, run details, and ask text before
  rendering its access-changed state.
- Missing, foreign, guessed, and never-authorized child IDs return the same unavailable response and
  view, revealing no conversation kind, parent, participants, runs, assets, or prior access.

Status: `API blocked`; current persistence conflates conversation lifecycle and archive visibility.

## CON-09 — Open a group Agent thread

**As a** group participant, **I want** an explicit `@agent` message to open a child Agent thread
**so that** governed agent work stays separate while useful outcomes can return to the group.

Acceptance criteria:

- The trigger remains an ordinary parent message; one idempotent admission creates one child
  `agent_session` conversation and its first run atomically.
- Parent and child retain independent history, cursors, unread position, and closed state.
- The child opens in the main workspace through immutable-id breadcrumbs, not a side panel or window.
- Child deliveries are append-only, sanitized, immediate-parent-only references for status,
  questions, approvals, results, failures, and finalized assets; they cannot mutate parent history.
- Later questions inside the child create serial follow-up runs.

Status: `API blocked`; child-conversation admission and upward delivery do not exist.
