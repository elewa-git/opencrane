# ADR 0012 — Conversation modes and Agent-thread authority

- **Status:** Accepted
- **Date:** 2026-08-10
- **Tasks:** [#600](https://github.com/elewa-git/opencrane/issues/600) ·
  [#601](https://github.com/elewa-git/opencrane/issues/601)
- **Related:** [#319](https://github.com/elewa-git/opencrane/issues/319) ·
  [#351](https://github.com/elewa-git/opencrane/issues/351) ·
  [ADR 0010](0010-language-neutral-agent-runtime.md)

## Context

The current `Thread` shape assumes every conversation belongs to one agent service and derives its
display history from run events. That assumption cannot represent direct or group messages without
inventing runs, and it cannot represent an Agent thread as a durable child conversation with its own
history. Lifecycle and personal list visibility are also conflated, while run timestamps cannot
provide one deterministic order for a timeline that contains participant messages and run events.

## Decision

- `Conversation` is the durable aggregate and **Chat** is its user-facing name. Every conversation
  stores exactly one immutable, string-backed mode: `agent_session`, `direct`, or `group`.
- An exhaustive discriminated strategy registry, selected only from the persisted mode, owns the
  commands allowed by each mode. Mode-specific behaviour is composed through that registry rather
  than class inheritance, request state, browser state, or repeated mode conditionals. Unsupported
  commands deny fail closed.
- `agent_session` requires exactly one agent service; `direct` and `group` prohibit one. Every new
  user question in an agent session admits a run, with at most one foreground run; steering and
  elicitation answers remain bound to that active run, while later questions serialize. Direct and
  ordinary group messages never create synthetic runs.
- Conversation lifecycle is open or monotonically closed. Archive, unread position, join visibility,
  and access end are participant-local coordinates and never reopen or rewrite the conversation.
- One database-owned, append-only monotonic position per conversation orders participant messages,
  safe run-backed projections, membership/system events, and parent deliveries in the canonical
  timeline. Cursors bind the conversation plus position, retries bind durable idempotency keys, and
  browser time or run-local event order never becomes cross-source authority.
- An authorized group `@agent` message remains in the parent timeline and idempotently creates one
  child `agent_session` conversation, its origin-parent-message binding, participants, and first run
  atomically. Parent and child keep independent history, cursors, unread position, participants, and
  lifecycle.
- A child may append sanitized, typed deliveries to its immediate parent for status, questions,
  approvals, results, failures, and finalized asset references. Delivery cannot impersonate a
  participant, mutate existing parent history, cross an ancestor boundary, or carry secret-bearing
  runtime payloads.
- Parent summaries project orthogonal run, conversation, access, recovery, and admission facts; no
  stored mega-enum combines those independent state machines.
- Public routes use immutable conversation identifiers. The server derives silo, membership, agent,
  run, and proof coordinates. Missing child identifiers, foreign children, wrong parent/child pairs,
  guessed identifiers, and never-authorized callers share one unavailable status, body, cache policy,
  and view. Only when the server proves that the same authenticated subject previously held durable
  child authorization may a client render an access-changed transition. Parent access, browser cache,
  or identifier possession is insufficient. Before rendering, the client synchronously purges all
  child-keyed rendered content, drafts, cursors and `Last-Event-ID`, query/persistent caches,
  filenames, run/ask details, and history-restoration state.
- Run admission and canonical `RunEvent` storage remain the execution authority. Conversation
  projection may expose bounded run state but cannot create a second approval, tool, artifact, or
  execution authority.

## Alternatives considered

- **Keep one agent-bound thread type** — rejected because direct and group messages would require
  fake runs or nullable invariants scattered across callers.
- **Allow mode changes** — rejected because changing mode would reinterpret persisted history and
  its authority after the fact.
- **Use an inheritance hierarchy** — rejected because persistence and API boundaries still need one
  stable discriminator, while a registry makes supported commands exhaustive and testable.
- **Treat Agent threads as run children or UI-only side panels** — rejected because they need durable
  participants, history, unread state, follow-up runs, routes, and parent communication. Runtime
  subagents remain governed child runs and are a separate concept.
- **Merge messages and run events by timestamp** — rejected because clocks and concurrent commits do
  not provide a stable replay cursor.
- **Return distinct not-found and unauthorized child states** — rejected because the difference
  discloses conversation existence and kind to a probing participant.

## Consequences

- The conversation model, public API, generated client, and UI use the mode vocabulary and strategy
  ownership together; compatibility aliases for the superseded mandatory-agent `Thread` contract are
  not added.
- Existing unambiguous agent-bound records migrate to `agent_session`. Ambiguous mode, lifecycle,
  participant, timeline, or active-run state fails the upgrade rather than being guessed.
- Message/run admission and timeline allocation require one transaction boundary. Replay consumes the
  canonical timeline instead of independently merging storage sources.
- Breadcrumb Agent-thread navigation replaces a side-panel-only experience and restores the exact
  parent root message and scroll position on return.
- Authorization tests must prove that direct and group messages cannot start runs, agent-session input
  cannot bypass runs, upward delivery cannot escape the immediate parent, and unavailable routes do
  not reveal existence or prior access.
