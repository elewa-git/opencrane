# Asset user stories

## Feature intent

Give an Owner a safe catalogue of documents and generated or uploaded artifacts without exposing
storage internals, leases, signatures, content addresses, or worker receipts.

Current status: `API ready` for read-only metadata, `UI missing`, `API blocked` for lifecycle actions.

## AST-01 — Browse my assets

**As an** Owner, **I want** to browse my assets **so that** I can find material associated with my
personal agent.

Acceptance criteria:

- The catalogue shows safe name/label metadata, kind, lifecycle state, indexing state, and timestamps.
- Kinds are `document`, `generated`, `skill`, and `upload`.
- Lifecycle states are `active` and `deletion_pending`.
- The list covers loading, empty, typical, 50-item limit, unavailable, long names, and inaccessible
  asset states.

API: `GET /api/v1/me/assets`.

## AST-02 — Understand indexing state

**As an** Owner, **I want** to understand whether an asset is usable for retrieval **so that** I do
not mistake uploaded metadata for indexed knowledge.

Acceptance criteria:

- Index states are `pending`, `indexed`, `failed`, `removal_pending`, `removed`, or not applicable.
- State copy explains consequence and next action without exposing worker internals.
- Failure and retry affordances are shown only when a public retry authority exists.

API: included in the asset catalogue response.

## AST-03 — Upload an asset

**As an** Owner, **I want** to upload a supported file **so that** it can enter the governed artifact
and indexing lifecycle.

Acceptance criteria:

- Type, size, malware scanning, ownership, progress, cancellation, processing, failure, and durable
  completion states are defined.
- A local preview is never treated as a durable server asset.

Status: `API blocked`; no public browser upload endpoint exists.

## AST-04 — Preview or download an asset

**As an** Owner, **I want** to inspect or download an asset I am authorized to access **so that** I
can verify its content.

Acceptance criteria:

- Access is time-bounded and owner/recipient-authorized.
- Unsupported preview, expired access, scanning pending, removed, and download failure are covered.

Status: `API blocked`; catalogue responses deliberately exclude bytes and content addresses.

## AST-05 — Delete or restore an asset

**As an** Owner, **I want** to remove an asset through a recoverable lifecycle **so that** content,
indexes, shares, and audit records are reconciled deliberately.

Status: `API blocked`; no public delete/restore endpoint exists.
