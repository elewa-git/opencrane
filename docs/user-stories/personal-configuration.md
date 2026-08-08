# Personal configuration user stories

## Feature intent

Allow an agent to propose bounded changes while the user retains explicit consent. Configuration
changes apply only to future immutable run snapshots.

Current status: `API ready`, `UI missing`, `Design ready`.

## CFG-01 — Review proposed changes

**As an** Owner, **I want** to see proposed configuration changes with their origin and effect **so
that** I can make an informed decision.

Acceptance criteria:

- The list distinguishes `proposed`, `accepted`, `applied`, `rejected`, and `superseded`.
- Supported patch kinds are visibly limited to `persona_refresh` and `model_alias`.
- The UI explains that an accepted change does not modify the active run.
- Empty, long rationale, stale, unavailable, and malformed-safe states are covered.

API: `GET /api/v1/me/configuration/changes`.

## CFG-02 — Accept a proposal

**As an** Owner, **I want** to accept a specific proposal **so that** it can proceed through its
governed materialization path.

Acceptance criteria:

- Acceptance names one immutable change ID.
- The confirmation explains whether the next step is model materialization or a persona interview.
- Repeated, stale, superseded, and conflicting decisions are finite states.

API: `POST /api/v1/me/configuration/changes/{changeId}/decision` with `accepted`.

## CFG-03 — Reject a proposal with a reason

**As an** Owner, **I want** to reject a proposal and record why **so that** the decision is explicit
and auditable.

Acceptance criteria:

- Rejection requires a bounded reason.
- The reason is confirmed before the proposal leaves the pending list.
- The UI does not offer materialization after rejection.

API: the same decision endpoint with `rejected` and `rejectionReason`.

## CFG-04 — Materialize an accepted model alias

**As an** Owner, **I want** an accepted model change to create a new immutable AgentRevision **so
that** future runs use the selected model without rewriting current execution.

Acceptance criteria:

- Materialization shows applied, stale-active-revision conflict, unavailable-model, and dependency
  failure states.
- Success links the proposal to the created revision.
- Persona refresh is never presented as directly materialized; it continues through its interview.

API: `POST /api/v1/me/configuration/changes/{changeId}/materialize` with an empty body.
