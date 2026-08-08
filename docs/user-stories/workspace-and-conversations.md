# Workspace and conversation user stories

## Feature intent

Provide the personal workspace where a user starts, resumes, and understands conversations with
their agent. The transcript is server-authoritative and recoverable; the browser is a client, not
the conversation ledger.

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

## CON-02 — Start a new conversation

**As a** user, **I want** to create a conversation **so that** I have an authoritative thread before
starting a run.

Acceptance criteria:

- Thread creation is idempotent or returns a single canonical thread ID.
- The server derives the participant and silo.
- Creation failure does not leave a local-only conversation that appears durable.

Status: `API blocked`; there is no public thread-create endpoint.

## CON-03 — Send the initiating prompt

**As a** user, **I want** to submit a message in a conversation **so that** my personal agent can
perform a governed run.

Acceptance criteria:

- The user sees queued, accepted, denied, capacity-limited, and unavailable outcomes.
- Duplicate submission is prevented or safely idempotent.
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
- Missing or foreign threads render as an empty non-disclosing stream.
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

- Every action is returned through a typed, authenticated, run/thread-bound public API.
- Disabled, expired, already-used, approval-required, and failed actions are finite states.
- A2UI rendering never performs privileged HTTP calls directly.

Status: `API blocked`; render primitives exist, but there is no public action-return protocol.
