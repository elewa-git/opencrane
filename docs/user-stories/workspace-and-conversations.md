# Workspace and conversation user stories

## Feature intent

Provide the workspace where participants start, resume, and understand agent sessions, direct chats,
and group chats. The conversation and its ordered timeline are server-authoritative and recoverable;
the browser is a client, not the conversation ledger.

Current status: the review branch has participant-scoped list, create, archive, close, HTTP message
submission and KurrentDB history reads. The workspace reads initial history through HTTP and follows
resumable browser events implemented under #827. Child agent sessions and attachments remain pending.
These are implementation states; complete live journeys are not yet qualified. The
[active plan](../../plan.md) records current progress, and
[ADR 0016](../adr/0016-conversation-history-and-computers.md) owns storage and computer lifecycle.

## Onboarding-chat boundary

The `bootstrap.md` onboarding chat is a bounded pre-main-app exchange owned by the onboarding
workflow, not a browser-local demo conversation and not ordinary workspace access. Its implemented
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

API: `GET /api/v1/me/conversations`. Archived conversations are excluded unless the participant
explicitly requests them.

## CON-02 — Start a mode-bound conversation

**As a** user, **I want** to create a conversation in one supported mode **so that** its behaviour is
authoritative before the first message or run.

Acceptance criteria:

- A successful creation returns the server-generated canonical conversation ID.
- The server derives the participant and silo.
- The immutable mode is `agent_session`, `direct`, or `group`; only an agent session binds an agent.
- Creation failure does not leave a local-only conversation that appears durable.
- A new creation command starts a new chat; retrying the same UUID returns the original chat without
  reopening it or adding participants or permissions.

API: `POST /api/v1/me/conversations`.

## CON-03 — Send input to an agent session

**As a** user, **I want** to submit a message in an agent session **so that** my personal agent can
perform a governed run.

Acceptance criteria:

- The user sees queued, accepted, denied, capacity-limited, and unavailable outcomes.
- Durable message admission and activation recover after partial failure; duplicate submission
  resolves to the same canonical result. A turn starts only after its exact input and current
  authority have been bound under ADR 0016.
- A later ordinary question starts the next serial run; steering or elicitation answers target the
  active run and cannot bypass run authority.
- Attachments are included only after an authoritative upload/attachment contract exists.
- The browser never supplies silo, membership, persona, memory dataset, or tool authority.

API: `POST /api/v1/me/conversations/{conversationId}/messages`. The participant sends text with an
idempotency key and receives a durable admission result. There is no public
`POST /api/v1/me/runs`; an ordinary group message does not activate an assistant.

## CON-04 — Replay the canonical transcript

**As a** conversation participant, **I want** to replay canonical events from a saved position **so
that** I can recover the display after refresh or reconnect.

Acceptance criteria:

- The client accepts validated events in KurrentDB revision order and keeps the position with its
  conversation ID. A position never chooses a stream or grants access.
- Missing, foreign, wrongly nested, and never-authorized conversations return one non-disclosing
  unavailable response rather than an existence-bearing stream.
- Rendering supports typical, long, tool-related, approval-related, terminal, and malformed-safe
  display states.

API: `GET /api/v1/me/conversations/{conversationId}/history?afterPosition={position}`. The decimal
position is exclusive. The server derives the stream from the authorized conversation and rechecks
current access before releasing private payloads. The removed socket route is not supported.

## CON-05 — Follow new events live

**As a** participant in an active run, **I want** new transcript events to appear as they happen **so
that** I can follow progress without manual refresh.

Acceptance criteria:

- Live delivery and finite historical replay have an explicit handoff.
- Reconnect does not duplicate or reorder events.
- The interface distinguishes connected, reconnecting, caught up, and terminal states.

Status: `implemented in the review branch` under #827. The workspace uses bounded, resumable SSE
from the same authorized KurrentDB history, with current access checks, cancellation on disconnect
and explicit connection limits. Initial history and a 30-second computer refresh still use the
existing HTTP replay path. The new stream needs live KurrentDB and multi-person journey proof.

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
- One KurrentDB conversation stream orders participant messages and safe execution entries
  without deriving order from browser clocks.
- Unsupported mode commands fail closed.

Status: `implemented in the review branch`. KurrentDB assigns stream revisions. Private text is
encrypted separately and referenced by the admitted entry; PostgreSQL remains the authorization
authority. Live mode-specific journey qualification remains pending.

## CON-08 — Join, read, close, and archive independently

**As a** participant, **I want** lifecycle, personal visibility, and access changes to stay distinct
**so that** a completed conversation cannot reopen and private history is not disclosed.

Acceptance criteria:

- Join visibility, unread position, and access-ended position are durable participant-specific
  timeline coordinates. A participant cannot write after access ends and can read no event beyond
  the recorded end position.
- Close is monotonic and makes the conversation read-only; archive is a reversible participant-local
  list state.
- Completed onboarding appears as a read-only session in the same list without manufacturing a
  normal Conversation or agent run. Independent onboarding archiving remains a product requirement.
- A revoked client purges child content, drafts, cursors, filenames, run details, and ask text before
  rendering its access-changed state.
- Missing, foreign, guessed, and never-authorized child IDs return the same unavailable response and
  view, revealing no conversation kind, parent, participants, runs, assets, or prior access.

Status: `partial`. List/open, reversible participant-local archive, permanent close and participant
positions are implemented. Completed onboarding is a distinct read-only session in the workspace
list. Independent onboarding archiving and full access-changed purge proof remain pending.

## CON-09 — Open a child agent session from a group

**As a** group participant, **I want** an explicit `@agent` message to open a child agent session
**so that** governed agent work stays separate while useful outcomes can return to the group.

Acceptance criteria:

- The trigger remains an ordinary parent message; one idempotent request creates one child
  `agent_session` and a recoverable first-turn activation. The creation sequence must follow
  ADR 0016 and cannot assume a transaction spanning the database, stream store and Pod controller.
- Parent and child retain independent history, cursors, unread position, and closed state.
- The child opens in the main workspace through immutable-id breadcrumbs, not a side panel or window.
- Child deliveries are append-only, sanitized, immediate-parent-only references for status,
  questions, approvals, results, failures, and finalized assets; they cannot mutate parent history.
- Later questions inside the child create serial follow-up runs.

Status: `API blocked`; child-conversation admission and upward delivery do not exist.
