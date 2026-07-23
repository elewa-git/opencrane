# @opencrane/backend/agents/personal/conversations — append-only run-event history

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › conversations

## What it owns

This package is part of the **personal-agent product** — the OpenCrane feature that gives each user
their own agent. A **run** is one execution of that agent (it works on a request from start to
finish). As a run proceeds it produces **run events**: small immutable records of things that
happened — a step began, a tool was called, a message was written, the run finished. This package is
the authority that decides whether a newly produced event is allowed to join a run's history.

It guarantees two things a newcomer should hold onto. First, **contiguous sequence**: events are
numbered 1, 2, 3, … with no gaps and no duplicates, so the history can always be replayed in the
exact order it happened. Second, **terminal fencing**: once a run records a terminal event (it has
ended), nothing more can ever be appended — the history is closed for good.

```
 agent runtime emits an event   (step · tool call · message · finished)
          │  runId · sequence · type · payload · occurredAt
          ▼
 ┌────────────────────────────────┐
 │   conversations   ◄── HERE      │  next in line? run still open?
 └────────────────────────────────┘
          │  appended (stored) / denied (+ reason)
          ▼
 event history  ── replayed in order by readers of the run
```

**In this flow:** [runs](../../runs/main/README.md) *(starts the run these events belong to, and appends on each attempt)*

The use case validates the event shape first (a real run id, a safe positive sequence, a parseable
timestamp), then hands the decision to one atomic database operation that owns the fencing. Invariant:
an event is stored only when the run exists, is not yet terminal, and its sequence is exactly the next
one expected. If any of those is wrong the append is denied with a stable reason (`sequence_conflict`,
`terminal`, `run_not_found`) — a caller can never mistake a rejected replay for a retryable slot.

The package also owns a normalized immutable reference from a pending user-input message to an exact
published `ArtifactRevision`. It never stores file paths, copied bytes, content addresses, or media
metadata in transcript JSON. The artifact authority remains responsible for all byte and revision
lifecycle decisions.

## Public surface

- `__AppendRunEvent(repository, command)` — the single use case: validate, then append one event atomically.
- `AppendRunEventCommand` / `AppendRunEventResult` — the request and the stable allow/deny outcome.
- `AtomicAppendRunEventResult` — the raw persistence outcome the repository returns.
- `ConversationAuthorityRepository` — the persistence port a caller must implement (or inject).
- `ConversationMessageArtifactAttachment` — the normalized immutable storage relation later used by
  the atomic user-input submission authority. It is deliberately not a standalone append endpoint:
  an attachment must be created in the same transaction as its user message.

## Boundary

Consumed by the runtime path that records agent activity. It owns no storage engine of its own: the
sequence-and-terminal fencing lives behind the injected `ConversationAuthorityRepository`, so this
package stays pure and testable. It is deliberately strict and fail-closed — anything malformed,
out of order, or arriving after the run ended is refused rather than coerced.

## Dependency direction

Tagged `scope:personal-conversations`: it may depend only on `scope:agents` (shared agent models),
`scope:personal-conversations`, and `scope:shared` — never on apps or sibling domains. Its attachment
relation references the canonical ArtifactRevision database contract; it does not import or own an
artifact-library implementation.

## Data & persistence

Persists canonical `RunEvent` rows (typed by `@opencrane/models/agents`) through the injected
repository; the append and its fencing commit as one atomic step. It also owns the normalized
`ConversationMessageArtifactAttachment` relation while artifacts retain ownership of
`ArtifactRevision`. The Postgres-level guarantees are exercised by the `test:sql` target
(`tests/conversation-authority.sql`).

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [runs](../../runs/main/README.md) · [memory](../../memory/main/README.md) · [personas](../../personas/main/README.md)
