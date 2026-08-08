# Organisational knowledge user stories

## Feature intent

Let an organisation ingest, govern, attach, and revoke shared knowledge without confusing discovery
sources, personal assets, memory, or an authority scope with the dataset itself.

Current status: `API blocked`, `UI missing`, `Needs decision`. Internal dataset and artifact
foundations do not provide a public organisational knowledge lifecycle. Third-party sources discover
candidate capabilities; they are not an organisational dataset API.

## KNO-01 — Browse organisational knowledge collections

**As an** authorised organisation member, **I want** to browse knowledge collections available to my
scope **so that** I can understand what governed material agents may use.

Acceptance criteria:

- A collection has an owner, organisational scope, purpose, lifecycle, source summary, document
  count, indexing summary, and last material change.
- The list distinguishes direct, group-derived, department, project, and organisation access without
  exposing unrelated subjects.
- Empty, loading, unavailable, minimal, large, access-lost, and retired states are defined.
- Internal Cognee dataset identifiers, storage coordinates, credentials, and worker proofs are never
  exposed.

Status: `API blocked`; there is no public organisational collection list/detail API.

## KNO-02 — Create a governed knowledge collection

**As an** authorised knowledge owner, **I want** to create a collection with a defined scope and
purpose **so that** documents enter one accountable authority boundary.

Acceptance criteria:

- The server derives the silo and validates the selected organisational scope.
- Creation records an owner, purpose, sensitivity/consent policy, and durable lifecycle before
  ingestion begins.
- Duplicate, forbidden, invalid scope, dependency unavailable, and success states are finite.

Status: `API blocked`; there is no public collection-create endpoint.

## KNO-03 — Ingest documents and follow indexing

**As an** authorised knowledge contributor, **I want** to add supported documents and follow their
processing **so that** I know when content is actually available for retrieval.

Acceptance criteria:

- Upload, validation, scanning, stored, indexing, indexed, failed, retrying, removal-pending, and
  removed are distinct durable states.
- Type and size limits, duplicate content, unsupported format, malware rejection, and partial batch
  failure have explicit outcomes.
- Success is not displayed before the durable content and required index state are recoverably
  recorded.

Status: `API blocked`; personal asset metadata and internal preprocessing do not provide this public
organisational ingestion journey.

## KNO-04 — Govern access to a collection

**As a** collection owner or organisation admin, **I want** to grant and revoke collection access by
authoritative scope, group, or user **so that** retrieval follows reviewed organisational policy.

Acceptance criteria:

- The UI previews the effective audience and explains direct versus inherited access.
- Revocation affects future run admission and does not rewrite completed run evidence.
- Stale membership, concurrent policy change, last-owner removal, and cross-silo selection fail
  closed.

Status: `API blocked`; generic resource sharing does not expose a complete dataset access-policy
contract.

## KNO-05 — Attach exact knowledge to an agent revision

**As an** organisation admin, **I want** to attach an exact authorised knowledge collection/version
to a managed-agent revision **so that** future runs freeze the reviewed retrieval boundary.

Acceptance criteria:

- Selection includes only collections the administrator may attach to the chosen agent scope.
- The revision review names the collection, immutable version/snapshot, access basis, and retrieval
  consequence.
- Publication revalidates collection lifecycle, membership, attachment authority, and revocation.
- A scope attachment alone is not presented as proof that a dataset was selected.

Status: `API blocked`; managed-agent scope attachments exist, but there is no public knowledge
selection/version contract.

## KNO-06 — Retire or delete organisational knowledge

**As a** knowledge owner, **I want** to retire or delete a collection through a recoverable lifecycle
**so that** future retrieval stops while audit and completed-run evidence remain coherent.

Acceptance criteria:

- Confirmation explains document, index, agent-attachment, share, audit, and recovery consequences.
- Retired, deletion-pending, index-removal-pending, deleted, failed, and restored states are finite.
- Active agent revisions and schedules that depend on the collection are identified before the
  destructive transition.

Status: `API blocked`; no public collection retirement/deletion API exists.
