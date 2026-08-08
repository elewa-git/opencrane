# Skill user stories

## Feature intent

Expose governed, revocable skills as reviewed agent capabilities while keeping bundles, signatures,
workload coordinates, and authoring proof outside ordinary browser reads.

Current status: `API ready` for the safe catalogue, `UI missing`, `API blocked` for authoring and
governance mutations.

## SKL-01 — Browse governed skills

**As a** user, **I want** to browse skills available in my silo **so that** I understand which
reviewed capabilities can be attached to agents.

Acceptance criteria:

- Logical skill state is `active` or `retired`.
- Current revision state is `draft`, `review`, `published`, `rejected`, `revoked`, or absent.
- The catalogue does not expose bundle locations, signatures, workload identity, or review internals.
- Empty, loading, unavailable, no-current-revision, revoked, and retired states are designed.

API: `GET /api/v1/skills`.

## SKL-02 — Inspect a skill revision

**As an** authorised user, **I want** to inspect a skill's safe description, version, provenance,
permissions, and review status **so that** I can decide whether it belongs in an agent revision.

Status: `API blocked`; the current catalogue exposes only bounded list metadata and no public detail
route.

## SKL-03 — Author a skill

**As a** skill author, **I want** to submit a bounded source package for isolated authoring **so that**
OpenCrane can produce a reviewable immutable revision.

Acceptance criteria:

- Upload, validation, scanning, queued, assigned, succeeded, failed, and cancelled states are finite.
- The browser never supplies runtime ServiceAccount identity, workload UID, Pod UID, bootstrap proof,
  or signing authority.

Status: `API blocked`; the workload protocol exists internally, but no public authoring trigger exists.

## SKL-04 — Review, publish, revoke, or retire a skill

**As a** skill governor, **I want** finite revision and logical-skill transitions **so that** only
reviewed capabilities can enter future agent revisions and compromised versions can be revoked.

Status: `API blocked`; no public governance mutation routes exist.

## SKL-05 — Attach an exact skill revision to an agent

**As an** organisation admin, **I want** a managed-agent revision to reference an exact published
skill revision **so that** future runs freeze one reviewed capability version.

Acceptance criteria:

- Selection excludes rejected, revoked, and inaccessible revisions.
- The agent review shows the exact skill and revision IDs and consequences of later revocation.

API: attachment is supported inside managed-agent revision content; discovery/detail support remains
partial.
