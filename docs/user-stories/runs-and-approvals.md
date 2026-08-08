# Runs and approvals user stories

## Feature intent

Make execution understandable and controllable without exposing workload credentials, Kubernetes
coordinates, proof keys, or internal retry machinery.

Current status: `API partial`, `UI missing`, `Design ready` for list/status/steering and the approval
inbox. Public cancellation and retry are blocked; production approval activation is incomplete.

## RUN-01 — Start a run from an authoritative thread

**As a** conversation participant, **I want** to start one idempotent run **so that** duplicate clicks
or retries do not create duplicate work.

Acceptance criteria:

- The client supplies only `threadId` and `requestIdempotencyKey`.
- Fresh and idempotent responses lead to the same canonical run.
- Authority refusal, concurrency limit, queue saturation, and dependency unavailability are distinct.
- The UI never asks the user to choose a silo, dataset, membership proof, persona revision, or
  workload identity.

API: `POST /api/v1/me/runs`.

## RUN-02 — See my run history and status

**As an** Owner, **I want** to see recent runs and their current state **so that** I can understand
what is active, waiting, complete, failed, or cancelled.

Acceptance criteria:

- Canonical states are `accepted`, `queued`, `assigned`, `running`, `waiting_for_approval`,
  `cancelling`, `completed`, `failed`, and `cancelled`.
- Terminal reason text is stable and user-safe; raw internal errors and infrastructure identities
  are never rendered.
- List, detail, empty, stale, unavailable, and not-found states are designed.

APIs: `GET /api/v1/me/runs`, `GET /api/v1/me/runs/{runId}`.

## RUN-03 — Steer a live run once

**As a** user, **I want** to submit a bounded steering instruction during a live attempt **so that** I
can correct direction without mutating its admitted authority snapshot.

Acceptance criteria:

- Steering is available only for eligible assigned, running, or approval-waiting attempts.
- Text is trimmed, required, and limited to 4,000 characters.
- The UI distinguishes pending, accepted, conflict/not-steerable, not-found, and unavailable states.
- A second resume boundary is not implied when the attempt has already consumed it.

API: `POST /api/v1/me/runs/{runId}/steering`.

## RUN-04 — Decide a deferred tool approval

**As an** Owner, **I want** to approve or deny a pending external action **so that** sensitive work
continues only with my explicit consent.

Acceptance criteria:

- The inbox contains only the current owner's pending approvals.
- The UI displays safe identity and timing metadata, not raw tool arguments, policy proofs, or
  resume credentials.
- Decision values are exactly `approved` or `denied`.
- Same-decision replay is idempotent; expired, foreign, and terminal requests fail closed.

APIs: `GET /api/v1/me/approvals`, `POST /api/v1/me/approvals/{approvalRequestId}/decision`.

Status: `API partial`; the finite browser API exists, but production creation and post-decision
resume transitions are not yet complete.

## RUN-05 — Cancel an active run

**As a** user, **I want** to cancel an eligible active attempt **so that** execution and pending
approvals stop promptly.

Acceptance criteria:

- Cancellation is expected-attempt fenced and visibly moves through `cancelling` to `cancelled`.
- Pending approvals and runtime authority are revoked before cleanup is treated as complete.
- Duplicate, stale-attempt, already-terminal, and cleanup-delayed outcomes are defined.

Status: `API blocked`; durable cancellation logic exists internally, but there is no public route.

## RUN-06 — Retry a failed or cancelled run

**As a** user, **I want** to retry from an explicit prior run **so that** the new attempt is traceable
without rewriting history.

Acceptance criteria:

- Retry creates a new attempt/run identity and preserves the prior terminal record.
- The new admission freezes current authority and configuration instead of reusing stale proof.

Status: `API blocked`; no public retry endpoint exists.
