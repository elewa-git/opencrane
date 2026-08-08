# Managed agent user stories

## Feature intent

Let organisation administrators define bounded agents for scheduled or explicit work, with immutable
revisions, optimistic concurrency, narrow attachments, and visible run history.

Current status: `API ready`, `UI missing`, `Design ready`. Fourteen of the fifteen operations are
absent from generated OpenAPI. Offline validation exists, while live runtime and scheduler
qualification must be shown separately.

## AGT-01 — Browse managed agents

**As an** organisation member, **I want** to browse agents visible in my silo **so that** I understand
their purpose, active revision, lifecycle, and recent activity.

Acceptance criteria:

- List and detail distinguish `draft`, `active`, `paused`, and `retired`.
- Cross-silo or invisible agents resolve as not found.
- Empty, loading, unavailable, long-name, and no-active-revision states are defined.

API: `GET /api/v1/agent-services`.

## AGT-02 — Create a managed agent

**As an** organisation admin, **I want** to create a managed agent and its first revision **so that**
its authority and behaviour are reviewed together.

Acceptance criteria:

- Required inputs include name, workload profile, change message, and revision content.
- Revision content names the model, prompt-policy version, optional persona, run limits, exact skill
  revisions, integration assignments, allowed tools, and scope attachments.
- The server validates the admin's authority over every attachment.
- Validation, forbidden, conflict, dependency-unavailable, and success states are designed.

API: `POST /api/v1/agent-services`.

## AGT-03 — Create, compare, and restore revisions

**As an** organisation admin, **I want** to create a revision, compare it with another, or restore old
content as a new revision **so that** history remains immutable and reviewable.

Acceptance criteria:

- Revision creation and restore require the expected parent revision.
- Compare identifies base and target explicitly.
- Restore never reactivates or mutates the historical record in place.
- Optimistic conflict offers refresh/review rather than silent overwrite.

APIs: `POST .../revisions`, `GET .../compare`, `POST .../restore`.

## AGT-04 — Publish an exact revision

**As an** organisation admin, **I want** to publish the revision I reviewed **so that** future runs
admit one explicit configuration.

Acceptance criteria:

- Publish names both the target revision and expected active revision.
- Success identifies the newly active revision.
- A concurrent publish conflict preserves both histories and asks the user to refresh.

API: `POST /api/v1/agent-services/{serviceId}/publish`.

## AGT-05 — Change lifecycle safely

**As an** organisation admin, **I want** to enable, pause, or retire an agent **so that** admission
matches deliberate operational state.

Acceptance criteria:

- Every transition supplies the expected current state.
- Invalid, concurrent, already-applied, and forbidden transitions are explicit.
- Destructive or service-stopping transitions require confirmation and explain schedule/run impact.

APIs: `POST .../enable`, `POST .../pause`, `POST .../retire`.

## AGT-06 — Run now and inspect history

**As an** organisation admin, **I want** to trigger one idempotent run and inspect recent runs **so
that** I can operate and troubleshoot the agent without editing its definition.

Acceptance criteria:

- Run-now accepts one request idempotency key and distinguishes fresh from idempotent admission.
- History shows trigger, revision, state, timestamps, and safe terminal outcome.
- Controller/runtime unavailable and admission-capacity states are distinct from definition errors.

APIs: `POST .../run-now`, `GET .../history`.

## AGT-07 — Manage schedules

**As an** organisation admin, **I want** to create, edit, enable, and remove schedules **so that** a
managed agent performs bounded recurring work.

Acceptance criteria:

- Schedule fields are cron, IANA timezone, overlap policy `skip|allow`, enabled, and catch-up window.
- The UI previews the next runs and names the timezone.
- Invalid cron/timezone, overlap consequences, missed-run catch-up, disabled scheduler, and delete
  confirmation are covered.
- Creating a schedule cannot imply it will fire when deployment-level scheduling is disabled.

APIs: `GET/POST .../schedules`, `PUT/DELETE .../schedules/{scheduleId}`.
